/**
 * Test Suite for Ride Matcher Service v2.0
 * 
 * These tests verify the core functionality of the matching algorithm.
 * We use Vitest as our test framework (similar to Jest but faster).
 * 
 * Test Categories:
 * 1. Basic Matching - Simple cases that should always work
 * 2. Outbound (FROM_EVENT) - Going home after an event
 *    - Early departure handling (hard constraint)
 *    - Everyone gets a ride (soft detour limit)
 * 3. Inbound (TO_EVENT) - Picking up passengers for an event
 *    - Calculated pickup times (shouldBeReadyBy)
 *    - Schedule generation
 * 4. Driver Sorting - Furthest drivers processed first
 * 5. Gender Preferences - Soft constraint for same-gender rides
 * 6. Metadata - Verify result statistics
 * 
 * Running tests:
 *   npm test                    - Run all tests
 *   npm test -- --watch        - Re-run on file changes
 *   npm test -- matching.test  - Run only this file
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Passenger,
  Driver,
  Gender,
  GenderPreference,
  Address,
  GeocodedLocation,
  TripDirection,
  UnmatchedReason
} from '../src/models/types';
import { MatchingEngine } from '../src/matchers/MatchingEngine';
import { MockGeocodingService } from '../src/utils/geocoding';
import { DEFAULT_CONFIG } from '../src/config/config';

// =============================================================================
// TEST DATA FACTORIES
// Helper functions to create test data with sensible defaults.
// Use overrides to customize specific fields for each test.
// =============================================================================

/**
 * Create a test address.
 * All test addresses are in San Francisco for consistency.
 */
const createAddress = (street: string): Address => ({
  street,
  city: 'San Francisco',
  state: 'CA',
  zipCode: '94102'
});

/**
 * Create a test passenger with default values.
 * Override any fields you need for your specific test.
 * 
 * @example
 * // Create an early-leaving female passenger
 * const alice = createPassenger({ 
 *   name: 'Alice', 
 *   gender: Gender.FEMALE,
 *   leavingEarly: true 
 * });
 */
const createPassenger = (overrides: Partial<Passenger> = {}): Passenger => ({
  // Generate a unique ID for each passenger
  id: `passenger-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Passenger',
  gender: Gender.MALE,
  age: 30,
  homeAddress: createAddress('123 Main St'),
  // Random coordinates near SF downtown
  homeCoordinates: { 
    lat: 37.7749 + (Math.random() * 0.01), 
    lng: -122.4194 + (Math.random() * 0.01) 
  },
  needsRide: true,
  genderPreference: GenderPreference.ANY,
  leavingEarly: false,
  // Spread overrides last so they take precedence
  ...overrides
});

/**
 * Create a test driver with default values.
 * Drivers have 3 seats by default.
 * 
 * @example
 * // Create a driver with 5 seats who's leaving early
 * const bob = createDriver({ 
 *   name: 'Bob', 
 *   availableSeats: 5,
 *   leavingEarly: true 
 * });
 */
const createDriver = (overrides: Partial<Driver> = {}): Driver => ({
  id: `driver-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Driver',
  gender: Gender.MALE,
  age: 35,
  homeAddress: createAddress('456 Oak Ave'),
  // Place driver slightly away from downtown
  homeCoordinates: { lat: 37.7800, lng: -122.4200 },
  canDrive: true,
  availableSeats: 3,
  leavingEarly: false,
  ...overrides
});

/**
 * Standard event location used in all tests.
 * This represents where the community event is held.
 */
const eventLocation: GeocodedLocation = {
  address: createAddress('100 Church St'),
  coordinates: { lat: 37.7749, lng: -122.4194 },
  formattedAddress: '100 Church St, San Francisco, CA 94102'
};

// =============================================================================
// TEST SUITE
// =============================================================================

describe('MatchingEngine v2.0', () => {
  // These are recreated fresh before each test
  let engine: MatchingEngine;
  let geoService: MockGeocodingService;

  /**
   * Setup: Create fresh instances before each test.
   * This ensures tests don't affect each other.
   */
  beforeEach(() => {
    geoService = new MockGeocodingService();
    engine = new MatchingEngine(geoService, DEFAULT_CONFIG);
  });

  // ===========================================================================
  // BASIC MATCHING TESTS
  // These test the fundamental matching functionality.
  // ===========================================================================
  
  describe('Basic Matching', () => {
    
    /**
     * The simplest possible case: 1 passenger + 1 driver = 1 ride group.
     * This should always work.
     */
    it('should match a single passenger to a single driver', async () => {
      const passengers = [createPassenger({ name: 'Alice' })];
      const drivers = [createDriver({ name: 'Bob' })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT  // Going home after event
      );

      // Should create exactly one ride group
      expect(result.rideGroups).toHaveLength(1);
      // With exactly one passenger
      expect(result.rideGroups[0].passengers).toHaveLength(1);
      expect(result.rideGroups[0].passengers[0].name).toBe('Alice');
      // No one should be left behind
      expect(result.unmatchedPassengers).toHaveLength(0);
    });

    /**
     * Passengers who don't need rides (needsRide=false) should be ignored.
     * Maybe they drove themselves or have another arrangement.
     */
    it('should not match passengers who do not need rides', async () => {
      const passengers = [
        createPassenger({ name: 'Alice', needsRide: true }),   // Needs a ride
        createPassenger({ name: 'Bob', needsRide: false })     // Has own car
      ];
      const drivers = [createDriver({ name: 'Charlie', availableSeats: 4 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Should only count Alice as needing a ride
      expect(result.metadata.totalPassengers).toBe(1);
      // Only Alice should be in the car
      expect(result.rideGroups[0].passengers).toHaveLength(1);
      expect(result.rideGroups[0].passengers[0].name).toBe('Alice');
    });

    /**
     * Vehicle capacity is a HARD constraint.
     * A car with 3 seats can't take 5 passengers.
     */
    it('should not exceed vehicle capacity', async () => {
      // Create 5 passengers
      const passengers = [
        createPassenger({ name: 'P1' }),
        createPassenger({ name: 'P2' }),
        createPassenger({ name: 'P3' }),
        createPassenger({ name: 'P4' }),
        createPassenger({ name: 'P5' })
      ];
      // But only one driver with 3 seats
      const drivers = [createDriver({ name: 'D1', availableSeats: 3 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Should respect the 3-seat limit
      expect(result.rideGroups[0].passengers.length).toBeLessThanOrEqual(3);
    });

    /**
     * Passengers should be assigned sequential stop orders (1, 2, 3, ...).
     * This tells the driver what order to drop people off.
     */
    it('should assign sequential stop orders', async () => {
      const passengers = [
        createPassenger({ name: 'P1' }),
        createPassenger({ name: 'P2' }),
        createPassenger({ name: 'P3' })
      ];
      const drivers = [createDriver({ name: 'D1', availableSeats: 4 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Extract the stop orders
      const orders = result.rideGroups[0].passengers.map(p => p.stopOrder);
      // Should be exactly [1, 2, 3]
      expect(orders).toEqual([1, 2, 3]);
    });
  });

  // ===========================================================================
  // OUTBOUND TESTS - EARLY DEPARTURE
  // Early departure is the most important constraint for outbound trips.
  // If someone needs to leave at 11am but their driver is staying until 1pm,
  // they'd be stuck waiting. This is NOT acceptable - it's a HARD constraint.
  // ===========================================================================
  
  describe('Outbound - Early Departure', () => {
    
    /**
     * HARD CONSTRAINT: Early passengers CANNOT ride with normal drivers.
     * This is the most important test for outbound trips.
     */
    it('should REJECT early passenger with non-early driver (hard constraint)', async () => {
      const passengers = [
        createPassenger({ name: 'Early Alice', leavingEarly: true }),   // Must leave early
        createPassenger({ name: 'Normal Nancy', leavingEarly: false })  // Staying till end
      ];
      const drivers = [
        createDriver({ name: 'Normal Driver', leavingEarly: false })    // Staying till end
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Normal Nancy should get a ride (compatible with normal driver)
      expect(result.rideGroups[0].passengers).toHaveLength(1);
      expect(result.rideGroups[0].passengers[0].name).toBe('Normal Nancy');

      // Early Alice should be UNMATCHED (not just low score - completely rejected)
      expect(result.unmatchedPassengers).toHaveLength(1);
      expect(result.unmatchedPassengers[0].name).toBe('Early Alice');
      // And the reason should be specific
      expect(result.unmatchedPassengers[0].reason).toBe(UnmatchedReason.EARLY_DEPARTURE_MISMATCH);
    });

    /**
     * Early passengers CAN ride with early drivers.
     * This is the happy path for early departure.
     */
    it('should match early passenger with early driver', async () => {
      const passengers = [
        createPassenger({ name: 'Early Alice', leavingEarly: true })
      ];
      const drivers = [
        createDriver({ name: 'Early Driver', leavingEarly: true })
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Should successfully match
      expect(result.rideGroups[0].passengers).toHaveLength(1);
      expect(result.rideGroups[0].passengers[0].name).toBe('Early Alice');
      expect(result.unmatchedPassengers).toHaveLength(0);
    });

    /**
     * Early drivers should NOT take normal passengers.
     * The driver would rush people who want to stay.
     */
    it('should NOT match normal passenger with early driver', async () => {
      const passengers = [
        createPassenger({ name: 'Normal Nancy', leavingEarly: false })
      ];
      const drivers = [
        createDriver({ name: 'Early Driver', leavingEarly: true })
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Early driver should have no passengers
      expect(result.rideGroups[0].passengers).toHaveLength(0);
      // Nancy should be unmatched
      expect(result.unmatchedPassengers).toHaveLength(1);
    });

    /**
     * When we have both early and normal drivers, the algorithm should
     * properly separate early passengers to early drivers, normal to normal.
     */
    it('should separate early and normal passengers to appropriate drivers', async () => {
      const passengers = [
        createPassenger({ name: 'Early P1', leavingEarly: true }),
        createPassenger({ name: 'Early P2', leavingEarly: true }),
        createPassenger({ name: 'Normal P3', leavingEarly: false })
      ];
      const drivers = [
        createDriver({ name: 'Early Driver', leavingEarly: true, availableSeats: 2 }),
        createDriver({ name: 'Normal Driver', leavingEarly: false, availableSeats: 2 })
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Find the early driver's group
      const earlyGroup = result.rideGroups.find(g => g.driver.leavingEarly);
      // All their passengers should be early
      expect(earlyGroup?.passengers.every(p => p.leavingEarly)).toBe(true);

      // Find the normal driver's group
      const normalGroup = result.rideGroups.find(g => !g.driver.leavingEarly);
      // All their passengers should be normal
      expect(normalGroup?.passengers.every(p => !p.leavingEarly)).toBe(true);
    });
  });

  // ===========================================================================
  // OUTBOUND TESTS - EVERYONE GETS A RIDE
  // For trips home, we prioritize giving everyone a ride over minimizing detour.
  // Even if someone lives far away, they should still get matched.
  // ===========================================================================
  
  describe('Outbound - Everyone Gets a Ride', () => {
    
    /**
     * A passenger who lives far away should still get a ride.
     * The algorithm should assign them to whoever has the least detour,
     * even if that detour exceeds the "preferred" limit.
     */
    it('should assign far-away passengers even if they exceed detour preference', async () => {
      // Create one passenger way out there
      const farPassenger = createPassenger({
        name: 'Far Away Fred',
        homeCoordinates: { lat: 37.9, lng: -122.6 }  // Far from the event
      });
      
      // And one passenger close by
      const nearPassenger = createPassenger({
        name: 'Nearby Nancy',
        homeCoordinates: { lat: 37.78, lng: -122.42 }  // Close to the event
      });
      
      const drivers = [
        createDriver({
          name: 'Driver Dan',
          homeCoordinates: { lat: 37.79, lng: -122.43 },
          availableSeats: 3
        })
      ];

      const result = await engine.match(
        [farPassenger, nearPassenger],
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // BOTH passengers should be matched - no one left behind
      expect(result.rideGroups[0].passengers).toHaveLength(2);
      expect(result.unmatchedPassengers).toHaveLength(0);
    });

    /**
     * When assigning a remaining passenger, choose the driver
     * who would have the LEAST additional detour.
     */
    it('should assign remaining passengers to driver with least detour', async () => {
      // Passenger lives west of the event
      const westPassenger = createPassenger({
        name: 'West Wendy',
        homeCoordinates: { lat: 37.77, lng: -122.50 }
      });
      
      // Driver going east (opposite direction)
      const eastDriver = createDriver({
        name: 'East Eddie',
        homeCoordinates: { lat: 37.77, lng: -122.35 },
        availableSeats: 2
      });
      
      // Driver going west (same direction as passenger)
      const westDriver = createDriver({
        name: 'West Walter',
        homeCoordinates: { lat: 37.77, lng: -122.55 },
        availableSeats: 2
      });

      const result = await engine.match(
        [westPassenger],
        [eastDriver, westDriver],
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // West Wendy should go with West Walter (same direction = less detour)
      const matchedGroup = result.rideGroups.find(g => g.passengers.length > 0);
      expect(matchedGroup?.driver.name).toBe('West Walter');
    });
  });

  // ===========================================================================
  // INBOUND TESTS - TIMING
  // For trips TO an event, timing is critical. Passengers need to know
  // when to be ready for pickup, and everyone must arrive on time.
  // ===========================================================================
  
  describe('Inbound - Timing', () => {
    // Event starts at 9:00 AM
    const eventStartTime = new Date('2024-01-01T09:00:00Z');

    /**
     * Inbound trips MUST have an event start time.
     * Without it, we can't calculate pickup times.
     */
    it('should require eventStartTime for inbound trips', async () => {
      const passengers = [createPassenger()];
      const drivers = [createDriver()];

      // Try to run matching without providing eventStartTime
      await expect(
        engine.match(
          passengers,
          drivers,
          eventLocation,
          TripDirection.TO_EVENT
          // Note: eventStartTime is intentionally missing
        )
      ).rejects.toThrow('eventStartTime is required');
    });

    /**
     * Basic inbound matching should work when eventStartTime is provided.
     */
    it('should match passengers for inbound trips', async () => {
      const passengers = [createPassenger({ name: 'Alice' })];
      const drivers = [createDriver({ name: 'Bob' })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        eventStartTime
      );

      expect(result.rideGroups).toHaveLength(1);
      expect(result.tripDirection).toBe(TripDirection.TO_EVENT);
    });

    /**
     * For inbound trips, passengers don't set their ready time.
     * Instead, the system CALCULATES when they need to be ready
     * and tells them via the shouldBeReadyBy field.
     */
    it('should calculate shouldBeReadyBy for passengers (system-generated, not user input)', async () => {
      const passengers = [createPassenger({ name: 'Alice' })];
      const drivers = [createDriver({ name: 'Bob' })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        eventStartTime
      );

      const passenger = result.rideGroups[0].passengers[0];
      
      // The system should have calculated when Alice needs to be ready
      expect(passenger.shouldBeReadyBy).toBeDefined();
      // That time should be BEFORE the event starts (obviously)
      expect(passenger.shouldBeReadyBy!.getTime()).toBeLessThan(eventStartTime.getTime());
    });

    /**
     * Drivers need to know when to leave their house.
     * The system calculates this based on the route.
     */
    it('should calculate driver departure time', async () => {
      const passengers = [createPassenger({ name: 'Alice' })];
      const drivers = [createDriver({ name: 'Bob' })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        eventStartTime
      );

      const group = result.rideGroups[0];
      
      // Driver should have a departure time
      expect(group.driver.departureTime).toBeDefined();
      // It should be before the event
      expect(group.driver.departureTime!.getTime()).toBeLessThan(eventStartTime.getTime());
    });

    /**
     * Inbound trips should include a complete schedule with:
     * - When the driver leaves home
     * - When to pick up each passenger
     * - When they'll arrive at the event
     */
    it('should build complete schedule for inbound trips', async () => {
      const passengers = [
        createPassenger({ name: 'Alice' }),
        createPassenger({ name: 'Bob' })
      ];
      const drivers = [createDriver({ name: 'Driver', availableSeats: 3 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        eventStartTime
      );

      const group = result.rideGroups[0];
      
      // Should have a complete schedule
      expect(group.schedule).toBeDefined();
      expect(group.schedule?.driverDepartureTime).toBeDefined();
      expect(group.schedule?.pickupTimes).toHaveLength(2);  // One for each passenger
      expect(group.schedule?.estimatedArrivalTime).toBeDefined();
      
      // Should arrive before or at event start
      expect(group.schedule?.estimatedArrivalTime.getTime())
        .toBeLessThanOrEqual(eventStartTime.getTime());
    });

    /**
     * For inbound trips, use pickupOrder (not dropOffOrder).
     * This tells the driver the order to pick people up.
     */
    it('should set pickupOrder for inbound passengers', async () => {
      const passengers = [
        createPassenger({ name: 'P1' }),
        createPassenger({ name: 'P2' })
      ];
      const drivers = [createDriver({ availableSeats: 3 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        eventStartTime
      );

      const orderedPassengers = result.rideGroups[0].passengers;
      
      orderedPassengers.forEach((p, i) => {
        // pickupOrder should be set for inbound
        expect(p.pickupOrder).toBe(i + 1);
        // dropOffOrder should NOT be set (that's for outbound)
        expect(p.dropOffOrder).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // DRIVER SORTING - FURTHEST FIRST
  // Drivers who live far away have a bigger "catchment area" for passengers.
  // They should be processed first to maximize matching efficiency.
  // ===========================================================================
  
  describe('Driver Sorting - Furthest First', () => {
    
    /**
     * A driver who lives far from the event has more opportunity
     * to pick up passengers "on the way" than a nearby driver.
     */
    it('should process furthest drivers first for outbound', async () => {
      // This driver lives very close to the event (just 1 block away)
      const driverClose = createDriver({ 
        id: 'driver-close',
        name: 'Close Driver',
        homeCoordinates: { lat: 37.7750, lng: -122.4195 },
        availableSeats: 2
      });
      
      // This driver lives far away (Oakland)
      const driverFar = createDriver({ 
        id: 'driver-far',
        name: 'Far Driver',
        homeCoordinates: { lat: 37.8044, lng: -122.2712 },
        availableSeats: 2
      });

      // Passenger lives between the event and the far driver
      const passenger = createPassenger({
        name: 'Middle Passenger',
        homeCoordinates: { lat: 37.79, lng: -122.35 }
      });

      const result = await engine.match(
        [passenger],
        [driverClose, driverFar],  // Note: close driver listed first
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // The FAR driver should get the passenger because they're processed first
      // and the passenger is "on the way" for them
      const matchedGroup = result.rideGroups.find(g => g.passengers.length > 0);
      expect(matchedGroup?.driver.id).toBe('driver-far');
    });
  });

  // ===========================================================================
  // GENDER PREFERENCES
  // Passengers can request same-gender drivers. This is a SOFT constraint
  // by default - we prefer to honor it but won't leave someone without a ride.
  // ===========================================================================
  
  describe('Gender Preferences', () => {
    
    /**
     * When a same-gender driver is available, the passenger
     * should be matched with them.
     */
    it('should prefer same-gender driver when requested', async () => {
      const passengers = [
        createPassenger({
          name: 'Alice',
          gender: Gender.FEMALE,
          genderPreference: GenderPreference.SAME_GENDER
        })
      ];
      const drivers = [
        createDriver({ name: 'Bob', gender: Gender.MALE, availableSeats: 2 }),
        createDriver({ name: 'Carol', gender: Gender.FEMALE, availableSeats: 2 })
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Alice should be matched with Carol (same gender)
      const aliceGroup = result.rideGroups.find(g =>
        g.passengers.some(p => p.name === 'Alice')
      );
      expect(aliceGroup?.driver.gender).toBe(Gender.FEMALE);
    });

    /**
     * If no same-gender driver is available, still give the passenger a ride.
     * Gender preference is SOFT by default - it's better to have a ride
     * than no ride at all.
     */
    it('should still match when gender preference cannot be met (soft constraint)', async () => {
      const passengers = [
        createPassenger({
          name: 'Alice',
          gender: Gender.FEMALE,
          genderPreference: GenderPreference.SAME_GENDER
        })
      ];
      // Only male drivers available
      const drivers = [
        createDriver({ name: 'Bob', gender: Gender.MALE, availableSeats: 2 })
      ];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Alice should still get a ride (soft constraint)
      expect(result.rideGroups[0].passengers).toHaveLength(1);
      expect(result.unmatchedPassengers).toHaveLength(0);
    });
  });

  // ===========================================================================
  // METADATA
  // The result includes statistics about the matching process.
  // These tests verify the metadata is accurate.
  // ===========================================================================
  
  describe('Metadata', () => {
    
    /**
     * The result should include the trip direction in multiple places.
     */
    it('should include tripDirection in result and metadata', async () => {
      const passengers = [createPassenger()];
      const drivers = [createDriver()];

      // Test outbound
      const outboundResult = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );
      expect(outboundResult.tripDirection).toBe(TripDirection.FROM_EVENT);
      expect(outboundResult.metadata.tripDirection).toBe(TripDirection.FROM_EVENT);

      // Test inbound
      const inboundResult = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.TO_EVENT,
        new Date('2024-01-01T09:00:00Z')
      );
      expect(inboundResult.tripDirection).toBe(TripDirection.TO_EVENT);
      expect(inboundResult.metadata.tripDirection).toBe(TripDirection.TO_EVENT);
    });

    /**
     * The matching duration should be tracked.
     * Useful for performance monitoring.
     */
    it('should track matching duration', async () => {
      const passengers = [createPassenger()];
      const drivers = [createDriver()];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      // Should have recorded how long matching took
      expect(result.metadata.matchingDurationMs).toBeGreaterThanOrEqual(0);
    });

    /**
     * The counts should accurately reflect the matching results.
     */
    it('should report correct counts', async () => {
      const passengers = [
        createPassenger({ name: 'P1' }),
        createPassenger({ name: 'P2' })
      ];
      const drivers = [createDriver({ availableSeats: 4 })];

      const result = await engine.match(
        passengers,
        drivers,
        eventLocation,
        TripDirection.FROM_EVENT
      );

      expect(result.metadata.totalPassengers).toBe(2);
      expect(result.metadata.totalDrivers).toBe(1);
      expect(result.metadata.matchedPassengers).toBe(2);
      expect(result.metadata.matchedDrivers).toBe(1);
    });
  });
});
