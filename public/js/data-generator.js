/**
 * Data Generator for Philadelphia Ride Matching Simulation
 * Generates realistic test data for passengers and drivers
 */

(function() {
    'use strict';

    // Real Philadelphia street names
    const PHILLY_STREETS = [
        'Market St', 'Broad St', 'Walnut St', 'Chestnut St', 'Spruce St',
        'Pine St', 'Locust St', 'Arch St', 'Race St', 'Vine St',
        'Spring Garden St', 'Girard Ave', 'Fairmount Ave', 'Passyunk Ave',
        'Oregon Ave', 'Snyder Ave', 'Washington Ave', 'South St',
        'Lombard St', 'Fitzwater St'
    ];

    // Real Philadelphia neighborhoods
    const PHILLY_NEIGHBORHOODS = [
        'Center City', 'University City', 'Fishtown', 'Northern Liberties',
        'Manayunk', 'Germantown', 'Mount Airy', 'Chestnut Hill',
        'Roxborough', 'South Philadelphia', 'West Philadelphia', 'Kensington',
        'Port Richmond', 'Frankford', 'Olney', 'Logan', 'Brewerytown',
        'Fairmount', 'Graduate Hospital', 'Bella Vista'
    ];

    // Korean-American names
    const KOREAN_LAST_NAMES = ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Han', 'Oh', 'Seo', 'Shin', 'Kwon'];
    const KOREAN_FIRST_NAMES = ['Jihoon', 'Minho', 'Soyoung', 'Eunji', 'Dohyun', 'Yeji', 'Jiwon', 'Hyunwoo', 'Seoyeon', 'Minseok', 'Chaeyoung', 'Junhyuk', 'Subin', 'Taehyun', 'Nayeon'];
    const ENGLISH_FIRST_NAMES = ['Daniel', 'Sarah', 'David', 'Grace', 'Joshua', 'Hannah', 'Andrew', 'Rachel', 'Matthew', 'Esther', 'Timothy', 'Rebecca', 'Samuel', 'Lydia', 'Nathan', 'Abigail'];

    // Vehicle information
    const CAR_MAKES = ['Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan', 'Subaru', 'Mazda', 'Ford', 'Chevrolet'];
    const CAR_MODELS = {
        Toyota: ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Sienna'],
        Honda: ['Accord', 'Civic', 'CR-V', 'Pilot', 'Odyssey'],
        Hyundai: ['Sonata', 'Elantra', 'Tucson', 'Santa Fe', 'Palisade'],
        Kia: ['Optima', 'Forte', 'Sportage', 'Sorento', 'Telluride'],
        Nissan: ['Altima', 'Sentra', 'Rogue', 'Pathfinder', 'Murano'],
        Subaru: ['Outback', 'Forester', 'Crosstrek', 'Legacy', 'Ascent'],
        Mazda: ['Mazda3', 'Mazda6', 'CX-5', 'CX-9', 'CX-30'],
        Ford: ['Fusion', 'Focus', 'Escape', 'Explorer', 'Edge'],
        Chevrolet: ['Malibu', 'Cruze', 'Equinox', 'Traverse', 'Tahoe']
    };
    const CAR_COLORS = ['White', 'Black', 'Silver', 'Gray', 'Blue', 'Red', 'Beige', 'Green'];

    /**
     * Generate random integer between min and max (inclusive)
     */
    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Pick random element from array
     */
    function randomPick(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    /**
     * Generate random name (mix of Korean and English first names)
     */
    function randomName() {
        const lastName = randomPick(KOREAN_LAST_NAMES);
        const firstName = Math.random() < 0.5 ? randomPick(KOREAN_FIRST_NAMES) : randomPick(ENGLISH_FIRST_NAMES);
        return `${firstName} ${lastName}`;
    }

    /**
     * Generate random address
     */
    function randomAddress() {
        const streetNumber = randomInt(100, 9999);
        const street = randomPick(PHILLY_STREETS);
        const city = randomPick(PHILLY_NEIGHBORHOODS);
        const zipCode = '191' + String(randomInt(0, 99)).padStart(2, '0');

        return {
            street: `${streetNumber} ${street}`,
            city: city,
            state: 'PA',
            zipCode: zipCode
        };
    }

    /**
     * Generate random coordinates within distance range from event location
     * @param {Object} eventLocation - { lat, lng }
     * @param {number} minMiles - minimum distance in miles
     * @param {number} maxMiles - maximum distance in miles
     * @returns {Object} { lat, lng }
     */
    function randomCoordinates(eventLocation, minMiles, maxMiles) {
        // Random angle (0 to 2π)
        const angle = Math.random() * 2 * Math.PI;

        // Random distance between min and max miles
        const distance = minMiles + Math.random() * (maxMiles - minMiles);

        // Convert miles to degrees
        // 1 degree latitude ≈ 69 miles
        // 1 degree longitude ≈ 55 miles at Philadelphia's latitude (39.95°)
        const latOffset = (distance * Math.cos(angle)) / 69;
        const lngOffset = (distance * Math.sin(angle)) / 55;

        return {
            lat: parseFloat((eventLocation.lat + latOffset).toFixed(6)),
            lng: parseFloat((eventLocation.lng + lngOffset).toFixed(6))
        };
    }

    /**
     * Generate random vehicle info
     */
    function randomVehicle() {
        const make = randomPick(CAR_MAKES);
        const model = randomPick(CAR_MODELS[make]);
        const color = randomPick(CAR_COLORS);

        return {
            make: make,
            model: model,
            color: color
        };
    }

    /**
     * Generate array of passengers
     * @param {number} count - number of passengers to generate
     * @param {Object} options - configuration options
     * @returns {Array} array of passenger objects
     */
    function generatePassengers(count, options = {}) {
        const {
            earlyDepartureRatio = 0.1,
            genderPreferenceRatio = 0.2,
            eventLocation = { lat: 39.9556, lng: -75.1944 },
            eventStartTime = new Date().toISOString(),
            distanceMin = 3,
            distanceMax = 20,
            ageMin = 20,
            ageMax = 65,
            maleRatio = 0.5
        } = options;

        const passengers = [];
        const eventTime = new Date(eventStartTime);

        for (let i = 0; i < count; i++) {
            const gender = Math.random() < maleRatio ? 'male' : 'female';
            const leavingEarly = Math.random() < earlyDepartureRatio;
            const hasGenderPreference = Math.random() < genderPreferenceRatio;

            // Early departure time is 30-60 minutes after event start
            let earlyDepartureTime = undefined;
            if (leavingEarly) {
                const minutesAfter = randomInt(30, 60);
                const earlyTime = new Date(eventTime.getTime() + minutesAfter * 60000);
                earlyDepartureTime = earlyTime.toISOString();
            }

            const passenger = {
                id: crypto.randomUUID(),
                name: randomName(),
                gender: gender,
                age: randomInt(ageMin, ageMax),
                homeAddress: randomAddress(),
                homeCoordinates: randomCoordinates(eventLocation, distanceMin, distanceMax),
                needsRide: true,
                genderPreference: hasGenderPreference ? 'same_gender' : 'any',
                leavingEarly: leavingEarly,
                earlyDepartureTime: earlyDepartureTime
            };

            passengers.push(passenger);
        }

        return passengers;
    }

    /**
     * Generate array of drivers
     * @param {number} count - number of drivers to generate
     * @param {Object} options - configuration options
     * @returns {Array} array of driver objects
     */
    function generateDrivers(count, options = {}) {
        const {
            earlyDepartureRatio = 0.1,
            eventLocation = { lat: 39.9556, lng: -75.1944 },
            eventStartTime = new Date().toISOString(),
            distanceMin = 5,
            distanceMax = 25,
            ageMin = 25,
            ageMax = 60,
            maleRatio = 0.5,
            seatMin = 2,
            seatMax = 6
        } = options;

        const drivers = [];
        const eventTime = new Date(eventStartTime);

        for (let i = 0; i < count; i++) {
            const gender = Math.random() < maleRatio ? 'male' : 'female';
            const leavingEarly = Math.random() < earlyDepartureRatio;

            // Early departure time is 30-60 minutes after event start
            let earlyDepartureTime = undefined;
            if (leavingEarly) {
                const minutesAfter = randomInt(30, 60);
                const earlyTime = new Date(eventTime.getTime() + minutesAfter * 60000);
                earlyDepartureTime = earlyTime.toISOString();
            }

            const driver = {
                id: crypto.randomUUID(),
                name: randomName(),
                gender: gender,
                age: randomInt(ageMin, ageMax),
                homeAddress: randomAddress(),
                homeCoordinates: randomCoordinates(eventLocation, distanceMin, distanceMax),
                canDrive: true,
                availableSeats: randomInt(seatMin, seatMax),
                leavingEarly: leavingEarly,
                earlyDepartureTime: earlyDepartureTime,
                vehicleInfo: randomVehicle()
            };

            drivers.push(driver);
        }

        return drivers;
    }

    // Export to global scope
    window.DataGenerator = {
        generatePassengers,
        generateDrivers
    };

})();
