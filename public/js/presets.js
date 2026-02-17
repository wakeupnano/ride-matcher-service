/**
 * Preset Scenarios for Ride Matching Simulation
 */

(function() {
    'use strict';

    const PRESETS = {
        sundayWorship: {
            name: '주일 예배',
            description: '일반적인 주일 오전 예배 카풀',
            passengers: 12,
            drivers: 4,
            earlyDepartureRatio: 0.08,
            genderPreferenceRatio: 0.15,
            // NEW params for data generator
            passengerDistanceMin: 3,
            passengerDistanceMax: 18,
            driverDistanceMin: 5,
            driverDistanceMax: 22,
            ageMin: 20,
            ageMax: 65,
            maleRatio: 0.5,
            seatMin: 3,
            seatMax: 5,
            tripDirection: 'to_event'
        },
        fridayYouth: {
            name: '금요 청년부',
            description: '금요일 저녁 청년부 모임 - 젊은 연령대',
            passengers: 15,
            drivers: 3,
            earlyDepartureRatio: 0.0,
            genderPreferenceRatio: 0.3,
            passengerDistanceMin: 2,
            passengerDistanceMax: 12,
            driverDistanceMin: 3,
            driverDistanceMax: 15,
            ageMin: 19,
            ageMax: 32,
            maleRatio: 0.45,
            seatMin: 3,
            seatMax: 5,
            tripDirection: 'to_event'
        },
        christmasService: {
            name: '성탄절 특별 예배',
            description: '대규모 성탄 예배 - 원거리 참석자 다수',
            passengers: 40,
            drivers: 10,
            earlyDepartureRatio: 0.2,
            genderPreferenceRatio: 0.2,
            passengerDistanceMin: 3,
            passengerDistanceMax: 30,
            driverDistanceMin: 5,
            driverDistanceMax: 30,
            ageMin: 18,
            ageMax: 75,
            maleRatio: 0.48,
            seatMin: 3,
            seatMax: 6,
            tripDirection: 'from_event'
        },
        bibleStudy: {
            name: '소그룹 성경공부',
            description: '평일 저녁 소그룹 - 근거리 소규모',
            passengers: 6,
            drivers: 2,
            earlyDepartureRatio: 0.0,
            genderPreferenceRatio: 0.1,
            passengerDistanceMin: 1,
            passengerDistanceMax: 5,
            driverDistanceMin: 1,
            driverDistanceMax: 6,
            ageMin: 28,
            ageMax: 50,
            maleRatio: 0.5,
            seatMin: 3,
            seatMax: 4,
            tripDirection: 'to_event'
        },
        seniorMinistry: {
            name: '어르신 부서',
            description: '주중 어르신 모임 - 동성 선호 높음',
            passengers: 8,
            drivers: 3,
            earlyDepartureRatio: 0.0,
            genderPreferenceRatio: 0.6,
            passengerDistanceMin: 2,
            passengerDistanceMax: 10,
            driverDistanceMin: 3,
            driverDistanceMax: 12,
            ageMin: 55,
            ageMax: 80,
            maleRatio: 0.35,
            seatMin: 3,
            seatMax: 4,
            tripDirection: 'to_event'
        },
        newMemberWelcome: {
            name: '새가족 환영회',
            description: '새가족 참석 - 넓은 지역 분포',
            passengers: 12,
            drivers: 4,
            earlyDepartureRatio: 0.25,
            genderPreferenceRatio: 0.35,
            passengerDistanceMin: 5,
            passengerDistanceMax: 25,
            driverDistanceMin: 3,
            driverDistanceMax: 20,
            ageMin: 22,
            ageMax: 55,
            maleRatio: 0.5,
            seatMin: 3,
            seatMax: 5,
            tripDirection: 'from_event'
        },
        badWeather: {
            name: '악천후 긴급',
            description: '폭설/폭우 - 드라이버 부족, 수요 폭증',
            passengers: 22,
            drivers: 3,
            earlyDepartureRatio: 0.5,
            genderPreferenceRatio: 0.05,
            passengerDistanceMin: 2,
            passengerDistanceMax: 15,
            driverDistanceMin: 3,
            driverDistanceMax: 10,
            ageMin: 18,
            ageMax: 70,
            maleRatio: 0.5,
            seatMin: 4,
            seatMax: 6,
            tripDirection: 'from_event'
        },
        capacityCrunch: {
            name: '좌석 부족',
            description: '소형차 위주 - 좌석 2석씩, 승객 초과',
            passengers: 20,
            drivers: 5,
            earlyDepartureRatio: 0.1,
            genderPreferenceRatio: 0.2,
            passengerDistanceMin: 3,
            passengerDistanceMax: 18,
            driverDistanceMin: 5,
            driverDistanceMax: 20,
            ageMin: 20,
            ageMax: 60,
            maleRatio: 0.5,
            seatMin: 2,
            seatMax: 2,
            tripDirection: 'from_event'
        },
        massEarlyDeparture: {
            name: '조기 출발 대량',
            description: '60%가 일찍 출발 - 드라이버 조기/일반 혼합',
            passengers: 18,
            drivers: 5,
            earlyDepartureRatio: 0.6,
            genderPreferenceRatio: 0.15,
            passengerDistanceMin: 3,
            passengerDistanceMax: 20,
            driverDistanceMin: 5,
            driverDistanceMax: 22,
            ageMin: 20,
            ageMax: 60,
            maleRatio: 0.5,
            seatMin: 3,
            seatMax: 5,
            tripDirection: 'from_event'
        },
        longDistance: {
            name: '원거리 분산',
            description: '전원 원거리 거주 - 우회 거리 최대화',
            passengers: 15,
            drivers: 4,
            earlyDepartureRatio: 0.1,
            genderPreferenceRatio: 0.2,
            passengerDistanceMin: 10,
            passengerDistanceMax: 28,
            driverDistanceMin: 12,
            driverDistanceMax: 30,
            ageMin: 25,
            ageMax: 55,
            maleRatio: 0.5,
            seatMin: 3,
            seatMax: 5,
            tripDirection: 'from_event'
        }
    };

    /**
     * Get a preset by key
     * @param {string} key - preset key
     * @returns {Object|null} preset configuration or null
     */
    function getPreset(key) {
        return PRESETS[key] || null;
    }

    /**
     * Get all preset keys
     * @returns {Array<string>} array of preset keys
     */
    function getPresetKeys() {
        return Object.keys(PRESETS);
    }

    /**
     * Get all presets
     * @returns {Object} all presets
     */
    function getAllPresets() {
        return PRESETS;
    }

    // Export to global scope
    window.Presets = {
        PRESETS,
        getPreset,
        getPresetKeys,
        getAllPresets
    };

})();
