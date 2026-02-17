/**
 * Main Application Controller
 * Ties together all modules and manages UI interactions
 */

(function() {
    'use strict';

    // State
    let currentPassengers = [];
    let currentDrivers = [];
    let eventLocation = { lat: 39.9556, lng: -75.1944 };
    let tripDirection = 'from_event';
    let eventStartTime = null;
    let activePreset = null; // Currently selected preset (for extended params)

    // Module instances
    let map = null;
    let simulation = null;

    /**
     * Initialize application on DOM ready
     */
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize map
        map = new window.SimulationMap('map');
        map.setEventLocation(eventLocation);

        // Initialize simulation
        simulation = new window.Simulation(map);

        // Set default event time to next Sunday at 10:00 AM
        setDefaultEventTime();

        // Wire up UI controls
        setupEventListeners();

        // Setup advanced algorithm settings
        setupAdvancedSettings();

        // Render preset buttons
        renderPresetButtons();

        // Initial slider value display
        updateSliderDisplays();
    });

    /**
     * Set default event time to next Sunday at 10:00 AM
     */
    function setDefaultEventTime() {
        const now = new Date();
        const nextSunday = new Date(now);

        // Calculate days until next Sunday (0 = Sunday)
        const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
        nextSunday.setDate(now.getDate() + daysUntilSunday);

        // Set to 10:00 AM
        nextSunday.setHours(10, 0, 0, 0);

        // Format for datetime-local input
        const year = nextSunday.getFullYear();
        const month = String(nextSunday.getMonth() + 1).padStart(2, '0');
        const day = String(nextSunday.getDate()).padStart(2, '0');
        const hours = String(nextSunday.getHours()).padStart(2, '0');
        const minutes = String(nextSunday.getMinutes()).padStart(2, '0');

        const formattedTime = `${year}-${month}-${day}T${hours}:${minutes}`;
        document.getElementById('eventTime').value = formattedTime;
        eventStartTime = nextSunday.toISOString();
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Event location inputs
        document.getElementById('eventLat').addEventListener('input', (e) => {
            eventLocation.lat = parseFloat(e.target.value);
            map.setEventLocation(eventLocation);
        });

        document.getElementById('eventLng').addEventListener('input', (e) => {
            eventLocation.lng = parseFloat(e.target.value);
            map.setEventLocation(eventLocation);
        });

        // Trip direction
        document.getElementById('tripDirection').addEventListener('change', (e) => {
            tripDirection = e.target.value;
        });

        // Event time
        document.getElementById('eventTime').addEventListener('change', (e) => {
            eventStartTime = new Date(e.target.value).toISOString();
        });

        // Sliders
        const sliders = [
            { id: 'passengerSlider', displayId: 'passengerCount' },
            { id: 'driverSlider', displayId: 'driverCount' },
            { id: 'earlySlider', displayId: 'earlyRatio' },
            { id: 'genderSlider', displayId: 'genderRatio' }
        ];

        sliders.forEach(({ id, displayId }) => {
            const slider = document.getElementById(id);
            slider.addEventListener('input', () => {
                updateSliderDisplays();
                // Clear active preset when manually adjusting sliders
                activePreset = null;
                document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
            });
        });

        // Action buttons
        document.getElementById('generateBtn').addEventListener('click', generateData);
        document.getElementById('runBtn').addEventListener('click', runSimulation);
        document.getElementById('resetBtn').addEventListener('click', resetSimulation);
    }

    /**
     * Setup advanced algorithm settings panel
     */
    function setupAdvancedSettings() {
        // Collapsible toggle
        const toggle = document.getElementById('advancedToggle');
        const panel = document.getElementById('advancedPanel');
        const icon = document.getElementById('collapseIcon');

        toggle.addEventListener('click', () => {
            const isCollapsed = panel.classList.toggle('collapsed');
            icon.textContent = isCollapsed ? '+' : '−';
        });

        // Weight sliders
        const weightSliders = [
            { sliderId: 'weightRoute', displayId: 'weightRouteVal', toggleId: 'toggleRouteEfficiency' },
            { sliderId: 'weightDetour', displayId: 'weightDetourVal', toggleId: 'toggleDetour' },
            { sliderId: 'weightGender', displayId: 'weightGenderVal', toggleId: 'toggleGender' },
            { sliderId: 'weightDriverPref', displayId: 'weightDriverPrefVal', toggleId: 'toggleDriverPref' },
            { sliderId: 'weightAge', displayId: 'weightAgeVal', toggleId: 'toggleAge' }
        ];

        weightSliders.forEach(({ sliderId, displayId, toggleId }) => {
            const slider = document.getElementById(sliderId);
            const display = document.getElementById(displayId);
            const toggle = document.getElementById(toggleId);

            slider.addEventListener('input', () => {
                display.textContent = slider.value;
                updateWeightTotal();
            });

            toggle.addEventListener('change', () => {
                slider.disabled = !toggle.checked;
                slider.style.opacity = toggle.checked ? '1' : '0.3';
                updateWeightTotal();
            });
        });

        // Threshold sliders
        const detourLimit = document.getElementById('detourLimit');
        const detourDisplay = document.getElementById('detourLimitVal');
        detourLimit.addEventListener('input', () => {
            detourDisplay.textContent = detourLimit.value;
        });

        const trafficBuffer = document.getElementById('trafficBuffer');
        const trafficDisplay = document.getElementById('trafficBufferVal');
        trafficBuffer.addEventListener('input', () => {
            trafficDisplay.textContent = (parseInt(trafficBuffer.value, 10) / 10).toFixed(1);
        });

        // Reset advanced button
        document.getElementById('resetAdvancedBtn').addEventListener('click', resetAdvancedSettings);
    }

    /**
     * Update weight total display and show warning if not 100
     */
    function updateWeightTotal() {
        const weights = getActiveWeights();
        const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
        const totalPercent = Math.round(total * 100);

        document.getElementById('weightTotal').textContent = totalPercent;

        const warning = document.getElementById('weightWarning');
        if (totalPercent !== 100) {
            warning.classList.remove('hidden');
        } else {
            warning.classList.add('hidden');
        }
    }

    /**
     * Get active weight values (disabled matchers = 0)
     * Values are normalized to 0-1 range
     */
    function getActiveWeights() {
        const get = (sliderId, toggleId) => {
            const enabled = document.getElementById(toggleId).checked;
            return enabled ? parseInt(document.getElementById(sliderId).value, 10) / 100 : 0;
        };

        return {
            routeEfficiency: get('weightRoute', 'toggleRouteEfficiency'),
            detour: get('weightDetour', 'toggleDetour'),
            genderMatch: get('weightGender', 'toggleGender'),
            driverPreference: get('weightDriverPref', 'toggleDriverPref'),
            ageMatch: get('weightAge', 'toggleAge')
        };
    }

    /**
     * Build configOverrides object from advanced settings
     */
    function getConfigOverrides() {
        const weights = getActiveWeights();

        // Normalize weights so they sum to 1.0
        const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
        const normalized = {};
        for (const [key, val] of Object.entries(weights)) {
            normalized[key] = total > 0 ? val / total : 0;
        }
        // earlyDeparture weight not exposed in UI; set to 0
        normalized.earlyDeparture = 0;

        const overrides = {
            weights: normalized,
            maxDetourMiles: parseInt(document.getElementById('detourLimit').value, 10),
            enforceGenderPreference: document.getElementById('enforceGender').checked,
            timing: {
                trafficBufferMultiplier: parseInt(document.getElementById('trafficBuffer').value, 10) / 10
            }
        };

        // Build priorityOrder based on enabled matchers (highest weight first)
        const matcherMap = {
            routeEfficiency: 'routeEfficiency',
            detour: 'detour',
            genderMatch: 'genderMatch',
            driverPreference: 'driverPreference',
            ageMatch: 'ageMatch'
        };

        const enabledMatchers = Object.entries(normalized)
            .filter(([key]) => key !== 'earlyDeparture' && normalized[key] > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([key]) => matcherMap[key])
            .filter(Boolean);

        // Always include earlyDeparture at the end if applicable
        enabledMatchers.push('earlyDeparture');
        overrides.priorityOrder = enabledMatchers;

        return overrides;
    }

    /**
     * Reset advanced settings to defaults
     */
    function resetAdvancedSettings() {
        // Weight sliders
        const defaults = [
            { sliderId: 'weightRoute', displayId: 'weightRouteVal', toggleId: 'toggleRouteEfficiency', value: 40 },
            { sliderId: 'weightDetour', displayId: 'weightDetourVal', toggleId: 'toggleDetour', value: 25 },
            { sliderId: 'weightGender', displayId: 'weightGenderVal', toggleId: 'toggleGender', value: 15 },
            { sliderId: 'weightDriverPref', displayId: 'weightDriverPrefVal', toggleId: 'toggleDriverPref', value: 15 },
            { sliderId: 'weightAge', displayId: 'weightAgeVal', toggleId: 'toggleAge', value: 5 }
        ];

        defaults.forEach(({ sliderId, displayId, toggleId, value }) => {
            const slider = document.getElementById(sliderId);
            const display = document.getElementById(displayId);
            const toggle = document.getElementById(toggleId);

            slider.value = value;
            slider.disabled = false;
            slider.style.opacity = '1';
            display.textContent = value;
            toggle.checked = true;
        });

        // Thresholds
        document.getElementById('detourLimit').value = 20;
        document.getElementById('detourLimitVal').textContent = '20';
        document.getElementById('trafficBuffer').value = 13;
        document.getElementById('trafficBufferVal').textContent = '1.3';
        document.getElementById('enforceGender').checked = false;

        updateWeightTotal();
    }

    /**
     * Update slider value displays
     */
    function updateSliderDisplays() {
        document.getElementById('passengerCount').textContent = document.getElementById('passengerSlider').value;
        document.getElementById('driverCount').textContent = document.getElementById('driverSlider').value;
        document.getElementById('earlyRatio').textContent = document.getElementById('earlySlider').value;
        document.getElementById('genderRatio').textContent = document.getElementById('genderSlider').value;
    }

    /**
     * Render preset buttons
     */
    function renderPresetButtons() {
        const container = document.getElementById('presetButtons');
        const presets = window.Presets.getAllPresets();

        const buttonsHtml = Object.keys(presets).map(key => {
            const preset = presets[key];
            return `
                <button class="preset-btn" data-preset="${key}">
                    <div class="preset-name">${preset.name}</div>
                    <div class="preset-desc">${preset.description}</div>
                </button>
            `;
        }).join('');

        container.innerHTML = buttonsHtml;

        // Attach click handlers
        container.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetKey = btn.dataset.preset;
                applyPreset(presetKey);

                // Visual feedback
                container.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    /**
     * Apply a preset configuration
     * @param {string} presetKey - preset key
     */
    function applyPreset(presetKey) {
        const preset = window.Presets.getPreset(presetKey);
        if (!preset) return;

        activePreset = preset;

        // Update sliders
        document.getElementById('passengerSlider').value = preset.passengers;
        document.getElementById('driverSlider').value = preset.drivers;
        document.getElementById('earlySlider').value = Math.round(preset.earlyDepartureRatio * 100);
        document.getElementById('genderSlider').value = Math.round(preset.genderPreferenceRatio * 100);

        // Update trip direction from preset
        if (preset.tripDirection) {
            tripDirection = preset.tripDirection;
            document.getElementById('tripDirection').value = tripDirection;
        }

        updateSliderDisplays();

        // Auto-generate data to preview
        generateData();
    }

    /**
     * Generate test data and show on map (pre-match state)
     */
    function generateData() {
        const passengerCount = parseInt(document.getElementById('passengerSlider').value, 10);
        const driverCount = parseInt(document.getElementById('driverSlider').value, 10);
        const earlyRatio = parseInt(document.getElementById('earlySlider').value, 10) / 100;
        const genderRatio = parseInt(document.getElementById('genderSlider').value, 10) / 100;

        // Ensure event start time is set
        if (!eventStartTime) {
            const timeInput = document.getElementById('eventTime').value;
            eventStartTime = new Date(timeInput).toISOString();
        }

        // Build options with preset extensions if available
        const passengerOpts = {
            earlyDepartureRatio: earlyRatio,
            genderPreferenceRatio: genderRatio,
            eventLocation: eventLocation,
            eventStartTime: eventStartTime
        };
        const driverOpts = {
            earlyDepartureRatio: earlyRatio,
            eventLocation: eventLocation,
            eventStartTime: eventStartTime
        };

        // Apply extended params from active preset
        if (activePreset) {
            if (activePreset.passengerDistanceMin != null) passengerOpts.distanceMin = activePreset.passengerDistanceMin;
            if (activePreset.passengerDistanceMax != null) passengerOpts.distanceMax = activePreset.passengerDistanceMax;
            if (activePreset.driverDistanceMin != null) driverOpts.distanceMin = activePreset.driverDistanceMin;
            if (activePreset.driverDistanceMax != null) driverOpts.distanceMax = activePreset.driverDistanceMax;
            if (activePreset.ageMin != null) { passengerOpts.ageMin = activePreset.ageMin; driverOpts.ageMin = activePreset.ageMin; }
            if (activePreset.ageMax != null) { passengerOpts.ageMax = activePreset.ageMax; driverOpts.ageMax = activePreset.ageMax; }
            if (activePreset.maleRatio != null) { passengerOpts.maleRatio = activePreset.maleRatio; driverOpts.maleRatio = activePreset.maleRatio; }
            if (activePreset.seatMin != null) driverOpts.seatMin = activePreset.seatMin;
            if (activePreset.seatMax != null) driverOpts.seatMax = activePreset.seatMax;
        }

        // Generate data
        currentPassengers = window.DataGenerator.generatePassengers(passengerCount, passengerOpts);
        currentDrivers = window.DataGenerator.generateDrivers(driverCount, driverOpts);

        // Show pre-match state on map
        map.showPreMatchState(currentPassengers, currentDrivers, eventLocation);

        // Hide results panel
        document.getElementById('resultsPanel').classList.add('hidden');
    }

    /**
     * Run the simulation
     */
    async function runSimulation() {
        // Validate that data has been generated
        if (currentPassengers.length === 0 || currentDrivers.length === 0) {
            alert('먼저 데이터를 생성해주세요. "데이터 재생성" 버튼을 클릭하세요.');
            return;
        }

        // Ensure event start time is set
        if (!eventStartTime) {
            const timeInput = document.getElementById('eventTime').value;
            eventStartTime = new Date(timeInput).toISOString();
        }

        // Show loading overlay
        const loadingOverlay = document.getElementById('loadingOverlay');
        loadingOverlay.classList.remove('hidden');

        try {
            // Run simulation with config overrides
            const result = await simulation.run({
                passengers: currentPassengers,
                drivers: currentDrivers,
                tripDirection: tripDirection,
                eventLocation: eventLocation,
                eventStartTime: eventStartTime,
                configOverrides: getConfigOverrides()
            });

            // Show results on map
            map.showMatchResults(result);

            // Render results panel
            const resultsPanel = document.getElementById('resultsPanel');
            simulation.renderResults(result, resultsPanel);
            resultsPanel.classList.remove('hidden');

        } catch (error) {
            console.error('Simulation error:', error);
            alert(`시뮬레이션 실행 중 오류가 발생했습니다:\n${error.message}`);
        } finally {
            // Hide loading overlay
            loadingOverlay.classList.add('hidden');
        }
    }

    /**
     * Reset the simulation to initial state
     */
    function resetSimulation() {
        // Clear data
        currentPassengers = [];
        currentDrivers = [];
        activePreset = null;

        // Clear map
        map.clear();
        map.setEventLocation(eventLocation);

        // Hide results
        document.getElementById('resultsPanel').classList.add('hidden');

        // Reset sliders to defaults
        document.getElementById('passengerSlider').value = 10;
        document.getElementById('driverSlider').value = 3;
        document.getElementById('earlySlider').value = 10;
        document.getElementById('genderSlider').value = 20;
        updateSliderDisplays();

        // Clear preset selection
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        // Reset event time to default
        setDefaultEventTime();

        // Reset event location to default
        eventLocation = { lat: 39.9556, lng: -75.1944 };
        document.getElementById('eventLat').value = eventLocation.lat;
        document.getElementById('eventLng').value = eventLocation.lng;
        map.setEventLocation(eventLocation);

        // Reset trip direction
        tripDirection = 'from_event';
        document.getElementById('tripDirection').value = tripDirection;

        // Reset advanced settings
        resetAdvancedSettings();
    }

})();
