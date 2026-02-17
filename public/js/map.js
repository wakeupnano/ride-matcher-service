/**
 * Leaflet Map Module for Ride Matching Visualization
 */

(function() {
    'use strict';

    // Polyline colors for different ride groups
    const GROUP_COLORS = [
        '#2196F3', '#4CAF50', '#FF9800', '#9C27B0',
        '#00BCD4', '#E91E63', '#795548', '#607D8B',
        '#FFC107', '#8BC34A', '#FF5722', '#3F51B5'
    ];

    class SimulationMap {
        constructor(containerId) {
            // Initialize map centered on Philadelphia
            this.map = L.map(containerId).setView([39.9526, -75.1652], 11);

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 18
            }).addTo(this.map);

            // Storage for markers and layers
            this.eventMarker = null;
            this.driverMarkers = [];
            this.passengerMarkers = [];
            this.polylines = [];
            this.routeMarkers = [];
            this.currentHighlight = null;

            // Marker groups for layer control (featureGroup supports getBounds)
            this.markersLayer = L.featureGroup().addTo(this.map);
            this.polylinesLayer = L.featureGroup().addTo(this.map);
        }

        /**
         * Set event location marker
         * @param {Object} coords - { lat, lng }
         */
        setEventLocation(coords) {
            if (this.eventMarker) {
                this.map.removeLayer(this.eventMarker);
            }

            // Create custom event icon (gold star)
            const eventIcon = L.divIcon({
                html: '<div style="font-size: 32px; text-align: center;">⭐</div>',
                className: 'event-marker',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });

            this.eventMarker = L.marker([coords.lat, coords.lng], { icon: eventIcon })
                .bindPopup('<b>행사 장소</b><br>3637 Chestnut St<br>Philadelphia, PA 19104')
                .addTo(this.markersLayer);
        }

        /**
         * Show pre-match state with all participants
         * @param {Array} passengers - array of passenger objects
         * @param {Array} drivers - array of driver objects
         * @param {Object} eventLocation - { lat, lng }
         */
        showPreMatchState(passengers, drivers, eventLocation) {
            this.clear();
            this.setEventLocation(eventLocation);

            // Add driver markers (blue)
            drivers.forEach(driver => {
                const marker = L.circleMarker(
                    [driver.homeCoordinates.lat, driver.homeCoordinates.lng],
                    {
                        radius: 8,
                        fillColor: '#2196F3',
                        color: '#1565C0',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }
                ).bindPopup(this._createDriverPopup(driver));

                marker.addTo(this.markersLayer);
                this.driverMarkers.push(marker);
            });

            // Add passenger markers (red)
            passengers.forEach(passenger => {
                const marker = L.circleMarker(
                    [passenger.homeCoordinates.lat, passenger.homeCoordinates.lng],
                    {
                        radius: 6,
                        fillColor: '#ef4444',
                        color: '#dc2626',
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.8
                    }
                ).bindPopup(this._createPassengerPopup(passenger));

                marker.addTo(this.markersLayer);
                this.passengerMarkers.push({ marker, passenger });
            });

            this.fitBounds();
        }

        /**
         * Show matching results on map
         * @param {Object} result - matching result from API
         */
        showMatchResults(result) {
            // Store event coordinates for route drawing
            this._eventCoords = result.startLocation.coordinates;

            // Clear previous polylines and route markers (in case of re-run)
            this.polylinesLayer.clearLayers();
            this.routeMarkers.forEach(m => this.markersLayer.removeLayer(m));
            this.polylines = [];
            this.routeMarkers = [];

            // Update passenger markers (matched = green, unmatched = gray)
            const matchedPassengerIds = new Set();

            result.rideGroups.forEach(group => {
                group.passengers.forEach(ap => {
                    matchedPassengerIds.add(ap.id);
                });
            });

            this.passengerMarkers.forEach(({ marker, passenger }) => {
                const isMatched = matchedPassengerIds.has(passenger.id);
                marker.setStyle({
                    fillColor: isMatched ? '#4CAF50' : '#9ca3af',
                    color: isMatched ? '#2E7D32' : '#6b7280'
                });
            });

            // Draw polylines for each ride group
            result.rideGroups.forEach((group, index) => {
                const color = GROUP_COLORS[index % GROUP_COLORS.length];
                this._drawRideGroupRoute(group, result.tripDirection, color, index);
            });

            this.fitBounds();
        }

        /**
         * Draw route for a single ride group
         * @param {Object} group - ride group object
         * @param {string} tripDirection - 'to_event' or 'from_event'
         * @param {string} color - polyline color
         * @param {number} groupIndex - group index for stop numbering
         */
        _drawRideGroupRoute(group, tripDirection, color, groupIndex) {
            const routePoints = [];
            const driver = group.driver;

            // Use stored event coordinates or driver's routeWaypoints
            const eventCoords = this._eventCoords || { lat: 39.9556, lng: -75.1944 };

            if (tripDirection === 'from_event') {
                // Route: Event → Passenger1 → Passenger2 → ... → Driver Home
                routePoints.push([eventCoords.lat, eventCoords.lng]);

                group.passengers.forEach((ap, idx) => {
                    routePoints.push([ap.homeCoordinates.lat, ap.homeCoordinates.lng]);

                    // Add stop number marker
                    this._addStopMarker(
                        [ap.homeCoordinates.lat, ap.homeCoordinates.lng],
                        idx + 1,
                        color
                    );
                });

                routePoints.push([driver.homeCoordinates.lat, driver.homeCoordinates.lng]);

            } else {
                // Route: Driver Home → Passenger1 → Passenger2 → ... → Event
                routePoints.push([driver.homeCoordinates.lat, driver.homeCoordinates.lng]);

                group.passengers.forEach((ap, idx) => {
                    routePoints.push([ap.homeCoordinates.lat, ap.homeCoordinates.lng]);

                    // Add stop marker
                    this._addStopMarker(
                        [ap.homeCoordinates.lat, ap.homeCoordinates.lng],
                        idx + 1,
                        color
                    );
                });

                routePoints.push([eventCoords.lat, eventCoords.lng]);
            }

            // Draw polyline
            const polyline = L.polyline(routePoints, {
                color: color,
                weight: 4,
                opacity: 0.7,
                smoothFactor: 1,
                className: `route-group-${groupIndex}`
            }).addTo(this.polylinesLayer);

            this.polylines.push({ polyline, groupIndex });
        }

        /**
         * Add stop number marker
         * @param {Array} coords - [lat, lng]
         * @param {number} stopNumber - stop sequence number
         * @param {string} color - marker color
         */
        _addStopMarker(coords, stopNumber, color) {
            const stopIcon = L.divIcon({
                html: `<div style="
                    width: 24px;
                    height: 24px;
                    background: ${color};
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 12px;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                ">${stopNumber}</div>`,
                className: 'stop-marker',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });

            const marker = L.marker(coords, { icon: stopIcon }).addTo(this.markersLayer);
            this.routeMarkers.push(marker);
        }

        /**
         * Highlight a specific ride group on map
         * @param {number} groupIndex - index of ride group to highlight
         */
        highlightGroup(groupIndex) {
            this.clearHighlight();

            // Find and highlight the polyline
            const routeGroup = this.polylines.find(p => p.groupIndex === groupIndex);
            if (routeGroup) {
                routeGroup.polyline.setStyle({
                    weight: 6,
                    opacity: 1
                });
                this.currentHighlight = routeGroup;

                // Fit map to highlighted route
                const bounds = routeGroup.polyline.getBounds();
                this.map.fitBounds(bounds, { padding: [50, 50] });
            }
        }

        /**
         * Clear route highlighting
         */
        clearHighlight() {
            if (this.currentHighlight) {
                this.currentHighlight.polyline.setStyle({
                    weight: 4,
                    opacity: 0.7
                });
                this.currentHighlight = null;
            }
        }

        /**
         * Clear all markers and polylines
         */
        clear() {
            this.markersLayer.clearLayers();
            this.polylinesLayer.clearLayers();

            this.driverMarkers = [];
            this.passengerMarkers = [];
            this.polylines = [];
            this.routeMarkers = [];
            this.currentHighlight = null;

            if (this.eventMarker) {
                this.map.removeLayer(this.eventMarker);
                this.eventMarker = null;
            }
        }

        /**
         * Fit map to show all markers
         */
        fitBounds() {
            const bounds = this.markersLayer.getBounds();
            if (bounds.isValid()) {
                this.map.fitBounds(bounds, { padding: [50, 50] });
            }
        }

        /**
         * Create driver popup content
         * @param {Object} driver - driver object
         * @returns {string} HTML popup content
         */
        _createDriverPopup(driver) {
            const genderIcon = driver.gender === 'male' ? '♂' : '♀';
            const genderColor = driver.gender === 'male' ? '#3b82f6' : '#ec4899';

            return `
                <div style="min-width: 180px;">
                    <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
                        🚗 ${driver.name}
                    </div>
                    <div style="font-size: 12px; color: #666;">
                        <span style="color: ${genderColor};">${genderIcon}</span> ${driver.age}세 |
                        좌석: ${driver.availableSeats}석
                    </div>
                    <div style="font-size: 12px; margin-top: 4px;">
                        ${driver.vehicleInfo.color} ${driver.vehicleInfo.make} ${driver.vehicleInfo.model}
                    </div>
                    <div style="font-size: 11px; color: #888; margin-top: 4px;">
                        ${driver.homeAddress.street}<br>
                        ${driver.homeAddress.city}, ${driver.homeAddress.state}
                    </div>
                    ${driver.leavingEarly ? '<div style="font-size: 11px; color: #f59e0b; margin-top: 4px;">⏰ 조기 출발</div>' : ''}
                </div>
            `;
        }

        /**
         * Create passenger popup content
         * @param {Object} passenger - passenger object
         * @returns {string} HTML popup content
         */
        _createPassengerPopup(passenger) {
            const genderIcon = passenger.gender === 'male' ? '♂' : '♀';
            const genderColor = passenger.gender === 'male' ? '#3b82f6' : '#ec4899';

            return `
                <div style="min-width: 180px;">
                    <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px;">
                        ${passenger.name}
                    </div>
                    <div style="font-size: 12px; color: #666;">
                        <span style="color: ${genderColor};">${genderIcon}</span> ${passenger.age}세
                    </div>
                    <div style="font-size: 11px; color: #888; margin-top: 4px;">
                        ${passenger.homeAddress.street}<br>
                        ${passenger.homeAddress.city}, ${passenger.homeAddress.state}
                    </div>
                    ${passenger.genderPreference === 'same_gender' ? '<div style="font-size: 11px; color: #8b5cf6; margin-top: 4px;">동성 선호</div>' : ''}
                    ${passenger.leavingEarly ? '<div style="font-size: 11px; color: #f59e0b; margin-top: 4px;">⏰ 조기 출발</div>' : ''}
                </div>
            `;
        }
    }

    // Export to global scope
    window.SimulationMap = SimulationMap;

})();
