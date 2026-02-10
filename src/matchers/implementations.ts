/**
 * Matcher Implementations
 * 
 * This file contains all the individual matchers that score passengers
 * for potential assignment to drivers. Each matcher handles one aspect
 * of the matching decision:
 * 
 * - TimingMatcher: Handles early departure (outbound) and arrival timing (inbound)
 * - CapacityMatcher: Ensures vehicle has available seats
 * - RouteEfficiencyMatcher: Scores how "on the way" a passenger is
 * - DetourMatcher: Calculates incremental detour when adding a passenger
 * - GenderMatcher: Handles same-gender preference
 * - AgeMatcher: Groups similar ages together
 * - DriverPreferenceMatcher: Future - passenger's preferred drivers
 * 
 * Each matcher returns:
 * - A score between 0 and 1 (higher = better match)
 * - null if the match is INVALID (hard constraint violated)
 */

import { BaseMatcher, MatcherContext } from './BaseMatcher';
import {
  Passenger,
  Driver,
  Gender,
  GenderPreference,
  TripDirection,
  isGenderMatch,
  getAgeGroup,
  calculateAgeDifference
} from '../models/types';

// =============================================================================
// TIMING MATCHER
// =============================================================================
/**
 * TimingMatcher handles time-based constraints for matching.
 * 
 * FOR OUTBOUND (FROM_EVENT):
 *   - If a passenger is leaving early (leavingEarly=true), they can ONLY
 *     be matched with a driver who is also leaving early.
 *   - This is a HARD constraint because an early-leaving passenger matched
 *     with a late driver would be stuck waiting.
 *   - Conversely, a driver leaving early should not take passengers who
 *     want to stay until the end (they'd rush those passengers).
 * 
 * FOR INBOUND (TO_EVENT):
 *   - We don't require passengers to set a "ready time".
 *   - Instead, we CALCULATE when they need to be ready based on the route.
 *   - The system tells the passenger: "Be ready by 8:15 AM" rather than
 *     asking "When can you be ready?"
 *   - The only hard constraint is if the pickup time would be impossibly
 *     early (e.g., 4 AM for a 9 AM event 5 miles away - something is wrong).
 */
export class TimingMatcher extends BaseMatcher {
  readonly name = 'timing';
  readonly priority = 0; // Highest priority - hard constraint
  
  /**
   * Score a passenger for timing compatibility with a driver.
   * Returns null if the match is invalid (hard constraint violated).
   */
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    if (context.tripDirection === TripDirection.TO_EVENT) {
      return this.scoreInboundTiming(passenger, driver, context);
    } else {
      return this.scoreOutboundTiming(passenger, driver, context);
    }
  }
  
  /**
   * Inbound timing: Check if the route timing is reasonable.
   * 
   * We calculate the pickup time based on the route. As long as the
   * pickup time is reasonable (not before 5 AM for a typical event),
   * the match is valid. The passenger will be told when to be ready.
   */
  private scoreInboundTiming(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    if (!context.eventStartTime) {
      // No event start time specified, can't validate timing
      return 0.5;
    }
    
    // Calculate when this passenger would be picked up
    const pickupTime = this.calculatePickupTime(passenger, driver, context);
    
    if (!pickupTime) {
      // Could not calculate pickup time (missing data)
      return null;
    }
    
    // Sanity check: pickup shouldn't be unreasonably early
    // Use UTC so tests and servers in any timezone behave consistently
    const pickupHour = pickupTime.getUTCHours();
    const eventHour = context.eventStartTime.getUTCHours();
    
    // If event is in the morning (before noon UTC) and pickup would be before 5 AM UTC
    if (eventHour < 12 && pickupHour < 5) {
      // This is suspiciously early - likely an error in distance/timing
      return null;
    }
    
    // If event is in the afternoon/evening and pickup would be before 6 AM UTC
    if (eventHour >= 12 && pickupHour < 6) {
      return null;
    }
    
    // Valid timing - all passengers get equal score for inbound
    // (the actual pickup time is just informational)
    return 0.7;
  }
  
  /**
   * Outbound timing: Check early departure compatibility.
   * 
   * HARD CONSTRAINTS:
   * 1. Early passenger + Non-early driver = INVALID
   *    (Passenger would be stuck waiting for driver to finish socializing)
   * 
   * 2. Non-early passenger + Early driver = INVALID
   *    (Driver would rush passengers who want to stay)
   * 
   * Only early+early or normal+normal combinations are valid.
   */
  private scoreOutboundTiming(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    // Case 1: Early passenger with non-early driver - INVALID
    if (passenger.leavingEarly && !driver.leavingEarly) {
      return null;
    }
    
    // Case 2: Non-early passenger with early driver - INVALID
    if (!passenger.leavingEarly && driver.leavingEarly) {
      return null;
    }
    
    // Case 3: Both leaving early - check specific times if provided
    if (passenger.leavingEarly && driver.leavingEarly) {
      if (passenger.earlyDepartureTime && driver.earlyDepartureTime) {
        // Passenger needs to leave after or when driver leaves
        if (passenger.earlyDepartureTime < driver.earlyDepartureTime) {
          return null; // Passenger needs to leave before driver is ready
        }
      }
      return 1.0; // Both leaving early, times compatible
    }
    
    // Case 4: Neither leaving early - perfect match
    return 0.5;
  }
  
  /**
   * Calculate when a passenger would be picked up for an inbound trip.
   * 
   * Uses backward calculation from event start time:
   * Pickup Time = Event Start - Travel Time to Event - Load Time Buffer
   * 
   * Where Travel Time = (Distance / Speed) × Traffic Buffer
   */
  calculatePickupTime(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): Date | null {
    if (!context.eventStartTime) return null;
    
    const eventStart = context.eventStartTime.getTime();
    const { trafficBufferMultiplier, loadTimeMinutes } = context.config.timing;
    
    // Get distance from passenger's home to the event
    const passengerToEvent = this.getDistanceFromEvent(passenger.id, context);
    
    if (passengerToEvent === Infinity) {
      return null;
    }
    
    // Dynamic speed based on distance
    const averageSpeedMph = this.getDynamicSpeed(passengerToEvent);
    
    // Calculate travel time with traffic buffer
    const travelTimeMinutes = (passengerToEvent / averageSpeedMph) * 60 * trafficBufferMultiplier;
    
    // Pickup time = Event Start - Travel Time - Load Time (getting in car)
    const pickupTimeMs = eventStart - (travelTimeMinutes * 60000) - (loadTimeMinutes * 60000);
    
    return new Date(pickupTimeMs);
  }
  
  /**
   * Get dynamic speed based on distance.
   * - Short trips (<5 mi): City driving ~20mph
   * - Medium trips (5-15 mi): Suburban ~35mph
   * - Long trips (>15 mi): Highway ~55mph
   */
  private getDynamicSpeed(distanceMiles: number): number {
    if (distanceMiles < 5) {
      return 20;
    } else if (distanceMiles < 15) {
      return 35;
    } else {
      return 55;
    }
  }
  
  /**
   * Calculate when a driver should depart from home for an inbound trip.
   * 
   * Departure Time = Event Start - Total Travel Time - All Load Times - Buffer
   */
  calculateDriverDepartureTime(
    driver: Driver,
    context: MatcherContext
  ): Date | null {
    if (!context.eventStartTime) return null;
    
    const eventStart = context.eventStartTime.getTime();
    const { trafficBufferMultiplier, loadTimeMinutes } = context.config.timing;
    
    // Get direct distance from driver home to event
    const directDistance = context.driverDirectDistances.get(driver.id) ?? Infinity;
    
    if (directDistance === Infinity) return null;
    
    // Dynamic speed based on distance
    const averageSpeedMph = this.getDynamicSpeed(directDistance);
    
    // Calculate travel time with buffer
    const travelTimeMinutes = (directDistance / averageSpeedMph) * 60 * trafficBufferMultiplier;
    
    // Add load time for each currently assigned passenger
    const currentAssignments = context.assignments.get(driver.id) || [];
    const pickupBuffer = currentAssignments.length * loadTimeMinutes;
    
    // Add extra 10-minute buffer for safety
    const safetyBuffer = 10;
    
    const departureTimeMs = eventStart 
      - (travelTimeMinutes * 60000) 
      - (pickupBuffer * 60000) 
      - (safetyBuffer * 60000);
    
    return new Date(departureTimeMs);
  }
  
  /**
   * Filter passengers to only those with valid timing.
   */
  filterValidPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    return passengers.filter(p => this.scorePassenger(p, driver, context) !== null);
  }
}

// =============================================================================
// EARLY DEPARTURE MATCHER
// =============================================================================
/**
 * EarlyDepartureMatcher provides additional scoring for early departure grouping.
 * 
 * Note: The hard constraint logic is in TimingMatcher. This matcher provides
 * additional scoring to prefer grouping early-leavers together when possible.
 * 
 * For inbound trips, this matcher is neutral (early departure doesn't apply).
 */
export class EarlyDepartureMatcher extends BaseMatcher {
  readonly name = 'early_departure';
  readonly priority = 1;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    // For inbound trips, early departure doesn't apply
    if (context.tripDirection === TripDirection.TO_EVENT) {
      return 0.5; // Neutral score
    }
    
    // For outbound, prefer matching early with early, normal with normal
    if (driver.leavingEarly && passenger.leavingEarly) {
      return 1.0; // Perfect match - both leaving early
    }
    
    if (!driver.leavingEarly && !passenger.leavingEarly) {
      return 0.5; // Good match - neither leaving early
    }
    
    // Mismatched cases are handled by TimingMatcher as hard constraints
    // This should not be reached if TimingMatcher runs first
    return 0.1;
  }
}

// =============================================================================
// CAPACITY MATCHER
// =============================================================================
/**
 * CapacityMatcher ensures vehicles have available seats.
 * 
 * This is a HARD constraint - if no seats are available, the match is invalid.
 * 
 * Scoring: Prefers filling cars that are already partially full.
 * This creates "full carpools" rather than many cars with one passenger each.
 * 
 * Example:
 * - Driver A has 4 seats, 0 used → fillRatio = 0 → score = 0.5
 * - Driver B has 4 seats, 3 used → fillRatio = 0.75 → score = 0.875
 * Driver B gets higher score, encouraging filling their car first.
 */
export class CapacityMatcher extends BaseMatcher {
  readonly name = 'capacity';
  readonly priority = 2;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    const remainingSeats = context.availableSeats.get(driver.id) ?? 0;
    
    // Hard constraint: no seats = no match
    if (remainingSeats <= 0) {
      return null;
    }
    
    // Score based on fill ratio (prefer filling partially-full cars)
    const usedSeats = driver.availableSeats - remainingSeats;
    const fillRatio = usedSeats / driver.availableSeats;
    
    // Score ranges from 0.5 (empty car) to 1.0 (almost full car)
    return 0.5 + (fillRatio * 0.5);
  }
  
  filterValidPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    const remainingSeats = context.availableSeats.get(driver.id) ?? 0;
    if (remainingSeats <= 0) {
      return [];
    }
    return passengers.filter(p => context.availablePassengers.has(p.id));
  }
}

// =============================================================================
// ROUTE EFFICIENCY MATCHER
// =============================================================================
/**
 * RouteEfficiencyMatcher scores how "on the way" a passenger is for a driver.
 * 
 * Uses the "Ellipse Model":
 * - Imagine an ellipse with two focal points: Origin and Destination
 * - Passengers near the line between these points are ideal matches
 * - Passengers perpendicular to this line add significant detour
 * 
 * For OUTBOUND (FROM_EVENT):
 *   Origin = Event location
 *   Destination = Driver's home
 *   Ideal: Passenger lives between event and driver's home
 * 
 * For INBOUND (TO_EVENT):
 *   Origin = Driver's home
 *   Destination = Event location
 *   Ideal: Passenger lives between driver's home and event
 * 
 * Efficiency Formula:
 *   efficiency = direct_distance / route_via_passenger
 *   
 *   efficiency = 1.0 → Passenger is perfectly on the way (no detour)
 *   efficiency = 0.5 → Route is 2x longer than direct (significant detour)
 *   efficiency < 0.5 → Very inefficient route
 * 
 * Note: For OUTBOUND trips, this is now a SOFT constraint. Even if a passenger
 * exceeds the preferred detour limit, they can still be matched if no better
 * option exists. The goal is to give everyone a ride home.
 */
export class RouteEfficiencyMatcher extends BaseMatcher {
  readonly name = 'route_efficiency';
  readonly priority = 3;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    // Get driver's direct distance (origin to destination)
    const directDistance = this.getDriverDirectDistance(driver, context);
    
    // Calculate route distance going via this passenger
    const routeViaPassenger = this.calculateRouteViaPassenger(passenger, driver, context);
    
    // If we can't calculate distances, can't score
    if (routeViaPassenger === Infinity || directDistance === Infinity) {
      return null;
    }
    
    // Calculate the detour (extra distance added)
    const detour = routeViaPassenger - directDistance;
    
    // For OUTBOUND: No hard detour limit - we want everyone to get a ride
    // For INBOUND: Still respect detour limit (timing is the real constraint)
    if (context.tripDirection === TripDirection.TO_EVENT) {
      if (detour > context.config.maxDetourMiles) {
        return null;
      }
    }
    
    // Calculate efficiency ratio
    const efficiency = directDistance / routeViaPassenger;
    
    // Convert to 0-1 score
    // efficiency >= 1.0 → score = 1.0 (passenger is on the way or even shortcut)
    // efficiency = 0.5 → score = 0.0 (route is 2x longer)
    // efficiency < 0.5 → score = 0.0 (clamped)
    const score = Math.max(0, Math.min(1, (efficiency - 0.5) * 2));
    
    return score;
  }
  
  /**
   * Calculate the total route distance if we go via this passenger.
   * 
   * OUTBOUND: Event → Passenger → Driver Home
   * INBOUND: Driver Home → Passenger → Event
   */
  calculateRouteViaPassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number {
    if (context.tripDirection === TripDirection.FROM_EVENT) {
      // Outbound: Event → Passenger → Driver Home
      const eventToPassenger = this.getDistanceFromEvent(passenger.id, context);
      const passengerToDriverHome = this.getDistance(passenger.id, driver.id, context);
      return eventToPassenger + passengerToDriverHome;
    } else {
      // Inbound: Driver Home → Passenger → Event
      const driverToPassenger = this.getDistance(driver.id, passenger.id, context);
      const passengerToEvent = this.getDistanceFromEvent(passenger.id, context);
      return driverToPassenger + passengerToEvent;
    }
  }
  
  /**
   * Calculate "on the way" score for sorting purposes.
   */
  calculateOnTheWayScore(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number {
    const directDistance = this.getDriverDirectDistance(driver, context);
    const routeViaPassenger = this.calculateRouteViaPassenger(passenger, driver, context);
    
    const detour = routeViaPassenger - directDistance;
    
    if (detour <= 0) return 1.0; // No detour (or even shorter!)
    
    // Score decreases as detour increases
    const maxDetour = context.config.maxDetourMiles;
    return Math.max(0, 1 - (detour / maxDetour));
  }
  
  sortPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    return [...passengers].sort((a, b) => {
      const scoreA = this.calculateOnTheWayScore(a, driver, context);
      const scoreB = this.calculateOnTheWayScore(b, driver, context);
      return scoreB - scoreA; // Higher score (less detour) first
    });
  }
}

// =============================================================================
// DETOUR MATCHER
// =============================================================================
/**
 * DetourMatcher calculates the INCREMENTAL detour when adding a passenger
 * to a driver's existing route.
 * 
 * This is different from RouteEfficiencyMatcher:
 * - RouteEfficiency: Is this passenger generally on the way?
 * - DetourMatcher: Given current passengers, how much MORE driving does this add?
 * 
 * For OUTBOUND trips: The detour limit is SOFT. If a passenger exceeds
 * the limit but there's no better option, they still get assigned.
 * The score is used to prefer lower-detour options when available.
 * 
 * For INBOUND trips: The detour limit affects scoring, but timing
 * constraints (arrival before event start) are the real hard constraint.
 */
export class DetourMatcher extends BaseMatcher {
  readonly name = 'detour_time';
  readonly priority = 5;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    // Get current assignments for this driver
    const currentAssignments = context.assignments.get(driver.id) || [];
    
    // Calculate current route distance
    const currentRouteDistance = this.calculateRouteDistance(
      currentAssignments,
      driver,
      context
    );
    
    // Calculate route distance with this passenger added
    const newRouteDistance = this.calculateRouteDistance(
      [...currentAssignments, passenger.id],
      driver,
      context
    );
    
    // Incremental detour = how much THIS passenger adds
    const incrementalDetour = newRouteDistance - currentRouteDistance;
    
    // Calculate total detour from direct route
    const directDistance = this.getDriverDirectDistance(driver, context);
    const totalDetour = newRouteDistance - directDistance;
    
    // For OUTBOUND: Don't reject based on detour - we want everyone to get home
    // For INBOUND: Apply the limit
    if (context.tripDirection === TripDirection.TO_EVENT) {
      if (totalDetour > context.config.maxDetourMiles) {
        return null;
      }
    }
    
    // Score: lower incremental detour = higher score
    // Normalize against max detour config
    const maxDetour = context.config.maxDetourMiles;
    const score = Math.max(0, 1 - (incrementalDetour / maxDetour));
    
    return score;
  }
  
  /**
   * Calculate total route distance for a set of passengers.
   * 
   * OUTBOUND: Event → Passenger1 → Passenger2 → ... → Driver Home
   * INBOUND: Driver Home → Passenger1 → Passenger2 → ... → Event
   */
  calculateRouteDistance(
    passengerIds: string[],
    driver: Driver,
    context: MatcherContext
  ): number {
    if (passengerIds.length === 0) {
      return this.getDriverDirectDistance(driver, context);
    }
    
    let totalDistance = 0;
    const isOutbound = context.tripDirection === TripDirection.FROM_EVENT;
    
    // Starting point
    let currentLocation = isOutbound ? 'event' : driver.id;
    
    // Visit each passenger in order
    for (const passengerId of passengerIds) {
      const legDistance = context.distanceMatrix.get(currentLocation)?.get(passengerId) ?? 0;
      totalDistance += legDistance;
      currentLocation = passengerId;
    }
    
    // Final leg to destination
    const destination = isOutbound ? driver.id : 'event';
    totalDistance += context.distanceMatrix.get(currentLocation)?.get(destination) ?? 0;
    
    return totalDistance;
  }
  
  /**
   * Calculate total detour for reporting purposes.
   */
  calculateTotalDetour(
    driver: Driver,
    assignedPassengerIds: string[],
    context: MatcherContext
  ): number {
    const directDistance = this.getDriverDirectDistance(driver, context);
    const routeDistance = this.calculateRouteDistance(assignedPassengerIds, driver, context);
    return routeDistance - directDistance;
  }
}

// =============================================================================
// GENDER MATCHER
// =============================================================================
/**
 * GenderMatcher handles same-gender ride preferences.
 * 
 * By default, this is a SOFT constraint:
 * - Passengers can request same-gender driver
 * - If no same-gender driver is available, they still get a ride
 * - The preference just affects scoring (same-gender gets higher score)
 * 
 * If config.enforceGenderPreference is true, it becomes a HARD constraint:
 * - Passengers with same-gender preference will ONLY match same-gender drivers
 * - They may go unmatched if no same-gender driver is available
 */
export class GenderMatcher extends BaseMatcher {
  readonly name = 'gender';
  readonly priority = 6;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    const matches = isGenderMatch(
      passenger.gender,
      driver.gender,
      passenger.genderPreference
    );
    
    // If passenger requires same gender and it doesn't match
    if (passenger.genderPreference === GenderPreference.SAME_GENDER && !matches) {
      if (context.config.enforceGenderPreference) {
        return null; // Hard constraint - no match
      }
      return 0.2; // Soft constraint - low score but still valid
    }
    
    // Good match
    return matches ? 1.0 : 0.6;
  }
  
  filterValidPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    if (!context.config.enforceGenderPreference) {
      return passengers; // All valid when soft constraint
    }
    
    return passengers.filter(p => {
      if (p.genderPreference === GenderPreference.ANY) {
        return true;
      }
      return isGenderMatch(p.gender, driver.gender, p.genderPreference);
    });
  }
}

// =============================================================================
// AGE MATCHER
// =============================================================================
/**
 * AgeMatcher provides soft scoring to group similar ages together.
 * 
 * This is never a hard constraint - it just provides a slight preference
 * for grouping people of similar ages when all else is equal.
 * 
 * The age grouping range is configurable (default: 15 years).
 */
export class AgeMatcher extends BaseMatcher {
  readonly name = 'age';
  readonly priority = 7;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    const ageDiff = calculateAgeDifference(passenger.age, driver.age);
    const maxAgeDiff = context.config.groupByAgeRange;
    
    // Within preferred age range
    if (ageDiff <= maxAgeDiff) {
      // Score from 0.5 to 1.0 based on how close in age
      return 1 - (ageDiff / maxAgeDiff) * 0.5;
    }
    
    // Outside preferred range but still valid (this is never a hard constraint)
    // Score decreases gradually for larger age differences
    return Math.max(0.1, 0.5 - (ageDiff - maxAgeDiff) / 50);
  }
  
  /**
   * Check if passenger and driver are in the same age group category.
   */
  isSameAgeGroup(passenger: Passenger, driver: Driver): boolean {
    return getAgeGroup(passenger.age) === getAgeGroup(driver.age);
  }
}

// =============================================================================
// DRIVER PREFERENCE MATCHER
// =============================================================================
/**
 * DriverPreferenceMatcher allows passengers to specify preferred drivers.
 * 
 * This is a FUTURE feature - currently returns neutral score for all.
 * 
 * When implemented, passengers could:
 * - Mark specific drivers as preferred
 * - Rank drivers in order of preference
 * - The matcher would give higher scores to preferred drivers
 */
export class DriverPreferenceMatcher extends BaseMatcher {
  readonly name = 'driver_preference';
  readonly priority = 4;
  
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null {
    // Future implementation:
    // if (passenger.preferredDriverIds?.includes(driver.id)) {
    //   return 1.0;
    // }
    // if (passenger.driverRankings) {
    //   const ranking = passenger.driverRankings.find(r => r.driverId === driver.id);
    //   if (ranking) {
    //     return Math.max(0.1, 1 - (ranking.rank - 1) * 0.2);
    //   }
    // }
    
    return 0.5; // Neutral score for now
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create all matcher instances.
 * Returns an object with each matcher keyed by its type name.
 */
export const createMatchers = () => ({
  timing: new TimingMatcher(),
  early_departure: new EarlyDepartureMatcher(),
  capacity: new CapacityMatcher(),
  route_efficiency: new RouteEfficiencyMatcher(),
  detour_time: new DetourMatcher(),
  gender: new GenderMatcher(),
  age: new AgeMatcher(),
  driver_preference: new DriverPreferenceMatcher()
});

export type MatcherMap = ReturnType<typeof createMatchers>;
