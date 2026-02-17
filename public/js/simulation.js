/**
 * Simulation Module - API Integration and Result Rendering
 */

(function() {
    'use strict';

    // Polyline colors matching map.js
    const GROUP_COLORS = [
        '#2196F3', '#4CAF50', '#FF9800', '#9C27B0',
        '#00BCD4', '#E91E63', '#795548', '#607D8B',
        '#FFC107', '#8BC34A', '#FF5722', '#3F51B5'
    ];

    // Korean translations for unmatch reasons
    const UNMATCH_REASONS = {
        'no_available_drivers': '가용 드라이버 없음',
        'exceeds_detour_limit': '우회 거리 초과',
        'gender_preference_unmet': '성별 선호 불충족',
        'no_seats_available': '좌석 부족',
        'early_departure_mismatch': '조기 출발 불일치',
        'cannot_arrive_on_time': '시간 내 도착 불가'
    };

    class Simulation {
        constructor(map) {
            this.map = map;
        }

        /**
         * Run simulation by calling the matching API
         * @param {Object} params - simulation parameters
         * @returns {Promise<Object>} matching result
         */
        async run(params) {
            const requestBody = {
                eventId: 'sim-' + Date.now(),
                tripDirection: params.tripDirection,
                eventLocation: params.eventLocation,
                passengers: params.passengers,
                drivers: params.drivers,
                eventStartTime: params.eventStartTime,
                configOverrides: params.configOverrides || undefined
            };

            try {
                const response = await fetch('/api/match', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error?.message || 'API request failed');
                }

                return data.result;

            } catch (error) {
                console.error('Simulation API error:', error);
                throw error;
            }
        }

        /**
         * Render matching results to the results panel
         * @param {Object} result - matching result object
         * @param {HTMLElement} containerElement - container to render into
         */
        renderResults(result, containerElement) {
            const html = `
                <div class="results-content">
                    ${this._renderStatistics(result)}
                    ${this._renderRideGroups(result)}
                    ${this._renderUnmatched(result)}
                </div>
            `;

            containerElement.innerHTML = html;

            // Attach event listeners for hover/click on ride groups
            this._attachRideGroupListeners();
        }

        /**
         * Render statistics summary card
         * @param {Object} result - matching result
         * @returns {string} HTML for statistics card
         */
        _renderStatistics(result) {
            const totalPassengers = result.metadata.totalPassengers;
            const matchedCount = result.metadata.matchedPassengers;
            const matchRate = totalPassengers > 0
                ? ((matchedCount / totalPassengers) * 100).toFixed(1)
                : 0;

            // Calculate average detour
            let totalDetour = 0;
            let driverCount = 0;

            result.rideGroups.forEach(group => {
                totalDetour += group.driver.totalDetour;
                driverCount++;
            });

            const avgDetour = driverCount > 0
                ? (totalDetour / driverCount).toFixed(2)
                : 0;

            const tripDirectionText = result.tripDirection === 'from_event' ? '행사 → 집' : '집 → 행사';
            const executionTime = result.metadata?.matchingDurationMs
                ? (result.metadata.matchingDurationMs / 1000).toFixed(2)
                : 'N/A';

            return `
                <div class="stats-card">
                    <h3>매칭 결과 요약</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-label">매칭률</div>
                            <div class="stat-value">${matchRate}%</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">매칭된 승객</div>
                            <div class="stat-value">${matchedCount}/${totalPassengers}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">평균 우회 거리</div>
                            <div class="stat-value">${avgDetour} mi</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">라이드 그룹 수</div>
                            <div class="stat-value">${result.rideGroups.length}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">알고리즘 실행 시간</div>
                            <div class="stat-value">${executionTime}s</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">이동 방향</div>
                            <div class="trip-badge">${tripDirectionText}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        /**
         * Render ride group cards
         * @param {Object} result - matching result
         * @returns {string} HTML for ride groups
         */
        _renderRideGroups(result) {
            if (result.rideGroups.length === 0) {
                return '<div class="section-header">매칭된 라이드 그룹이 없습니다.</div>';
            }

            const groupsHtml = result.rideGroups.map((group, index) => {
                return this._renderRideGroupCard(group, index, result.tripDirection);
            }).join('');

            return `
                <div class="section-header">라이드 그룹 (${result.rideGroups.length})</div>
                <div class="ride-groups">
                    ${groupsHtml}
                </div>
            `;
        }

        /**
         * Render single ride group card
         * @param {Object} group - ride group object
         * @param {number} index - group index
         * @param {string} tripDirection - trip direction
         * @returns {string} HTML for ride group card
         */
        _renderRideGroupCard(group, index, tripDirection) {
            const color = GROUP_COLORS[index % GROUP_COLORS.length];
            const driver = group.driver;
            const genderIcon = driver.gender === 'male' ? '♂' : '♀';
            const genderClass = driver.gender === 'male' ? 'gender-male' : 'gender-female';

            const seatsUsed = group.passengers.length;
            const seatsAvailable = driver.availableSeats;

            const passengersHtml = group.passengers.map((ap, idx) => {
                return this._renderPassengerItem(ap, idx + 1);
            }).join('');

            return `
                <div class="ride-card" data-group-index="${index}">
                    <div class="ride-card-header">
                        <div class="group-color-dot" style="background: ${color};"></div>
                        <div class="driver-info">
                            <div class="driver-name">
                                <span class="${genderClass}">${driver.name}</span>
                            </div>
                            <div class="driver-details">
                                ${driver.age}세 | ${driver.vehicleInfo ? `${driver.vehicleInfo.color} ${driver.vehicleInfo.make} ${driver.vehicleInfo.model}` : '차량 정보 없음'}
                            </div>
                        </div>
                        <div class="seats-info">
                            ${seatsUsed}/${seatsAvailable} 석
                        </div>
                    </div>

                    <div class="passenger-list">
                        ${passengersHtml}
                    </div>

                    <div class="route-summary">
                        <div>
                            <strong>총 거리:</strong> ${group.driver.totalRouteDistance.toFixed(2)} mi
                        </div>
                        <div>
                            <strong>총 우회:</strong> ${group.driver.totalDetour.toFixed(2)} mi
                        </div>
                    </div>
                </div>
            `;
        }

        /**
         * Render passenger item within ride group
         * @param {Object} ap - assigned passenger object
         * @param {number} stopNumber - stop sequence number
         * @returns {string} HTML for passenger item
         */
        _renderPassengerItem(ap, stopNumber) {
            const genderIcon = ap.gender === 'male' ? '♂' : '♀';
            const genderClass = ap.gender === 'male' ? 'gender-male' : 'gender-female';

            return `
                <div class="passenger-item">
                    <div class="stop-number">${stopNumber}</div>
                    <div class="passenger-details">
                        <div class="passenger-name">
                            <span class="${genderClass}">${ap.name}</span>
                        </div>
                        <div class="passenger-meta">
                            ${ap.age}세 | ${ap.homeAddress.city}
                        </div>
                    </div>
                    <div class="detour-info">
                        <div class="detour-added">+${ap.detourAdded.toFixed(2)} mi</div>
                        <div class="distance-from-origin">${ap.distanceFromOrigin.toFixed(2)} mi</div>
                    </div>
                </div>
            `;
        }

        /**
         * Render unmatched passengers and drivers
         * @param {Object} result - matching result
         * @returns {string} HTML for unmatched section
         */
        _renderUnmatched(result) {
            if (result.unmatchedPassengers.length === 0 && result.unmatchedDrivers.length === 0) {
                return '';
            }

            let html = '';

            // Unmatched passengers
            if (result.unmatchedPassengers.length > 0) {
                const unmatchedHtml = result.unmatchedPassengers.map(passenger => {
                    return this._renderUnmatchedPassenger(passenger);
                }).join('');

                html += `
                    <div class="section-header">매칭 실패 승객 (${result.unmatchedPassengers.length})</div>
                    <div class="unmatched-section">
                        <div class="unmatched-list">
                            ${unmatchedHtml}
                        </div>
                    </div>
                `;
            }

            // Unmatched drivers
            if (result.unmatchedDrivers.length > 0) {
                const unmatchedDriversHtml = result.unmatchedDrivers.map(driver => {
                    return this._renderUnmatchedDriver(driver);
                }).join('');

                html += `
                    <div class="section-header">미사용 드라이버 (${result.unmatchedDrivers.length})</div>
                    <div class="unmatched-section">
                        <div class="unmatched-list">
                            ${unmatchedDriversHtml}
                        </div>
                    </div>
                `;
            }

            return html;
        }

        /**
         * Render single unmatched passenger
         * @param {Object} passenger - passenger object
         * @returns {string} HTML for unmatched passenger
         */
        _renderUnmatchedPassenger(passenger) {
            const genderIcon = passenger.gender === 'male' ? '♂' : '♀';
            const genderClass = passenger.gender === 'male' ? 'gender-male' : 'gender-female';
            const reason = UNMATCH_REASONS[passenger.reason] || passenger.reason || '알 수 없음';

            return `
                <div class="unmatched-item">
                    <div class="unmatched-name">
                        <span class="${genderClass}">${passenger.name}</span> (${passenger.age}세)
                    </div>
                    <div style="font-size: 12px; color: #71717a; margin-top: 4px;">
                        ${passenger.homeAddress.street}, ${passenger.homeAddress.city}
                    </div>
                    <div style="margin-top: 8px;">
                        <span class="unmatched-reason">${reason}</span>
                    </div>
                </div>
            `;
        }

        /**
         * Render single unmatched driver
         * @param {Object} driver - driver object
         * @returns {string} HTML for unmatched driver
         */
        _renderUnmatchedDriver(driver) {
            const genderIcon = driver.gender === 'male' ? '♂' : '♀';
            const genderClass = driver.gender === 'male' ? 'gender-male' : 'gender-female';

            return `
                <div class="unmatched-item">
                    <div class="unmatched-name">
                        🚗 <span class="${genderClass}">${driver.name}</span> (${driver.age}세)
                    </div>
                    <div style="font-size: 12px; color: #71717a; margin-top: 4px;">
                        ${driver.vehicleInfo ? `${driver.vehicleInfo.color} ${driver.vehicleInfo.make} ${driver.vehicleInfo.model}` : '차량 정보 없음'} | ${driver.availableSeats}석
                    </div>
                    <div style="font-size: 12px; color: #71717a; margin-top: 4px;">
                        ${driver.homeAddress.street}, ${driver.homeAddress.city}
                    </div>
                </div>
            `;
        }

        /**
         * Attach event listeners to ride group cards for hover/click highlighting
         */
        _attachRideGroupListeners() {
            const rideCards = document.querySelectorAll('.ride-card');

            rideCards.forEach(card => {
                const groupIndex = parseInt(card.dataset.groupIndex, 10);

                card.addEventListener('mouseenter', () => {
                    this.map.highlightGroup(groupIndex);
                    card.classList.add('highlighted');
                });

                card.addEventListener('mouseleave', () => {
                    this.map.clearHighlight();
                    card.classList.remove('highlighted');
                });
            });
        }
    }

    // Export to global scope
    window.Simulation = Simulation;

})();
