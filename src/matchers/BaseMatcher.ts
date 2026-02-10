/**
 * BaseMatcher - Foundation for all matching criteria
 * 
 * Each matcher evaluates ONE aspect of passenger-driver compatibility:
 * - TimingMatcher: Early departure / arrival time constraints
 * - CapacityMatcher: Vehicle seat availability
 * - RouteEfficiencyMatcher: Is passenger "on the way"?
 * - DetourMatcher: How much extra driving does this add?
 * - GenderMatcher: Same-gender preference
 * - AgeMatcher: Group similar ages
 * - DriverPreferenceMatcher: Passenger's preferred drivers
 * 
 * Each matcher returns:
 * - A score from 0.0 to 1.0 (higher = better match)
 * - null if the match is INVALID (hard constraint violated)
 */

import {
  Passenger,
  Driver,
  MatchedPassenger,
  MatchedDriver,
  MatchingConfig,
  Coordinates,
  TripDirection
} from '../models/types';

// =============================================================================
// MATCHER CONTEXT
// =============================================================================

/**
 * Shared context passed to all matchers during a matching operation.
 * Contains pre-calculated distances and tracking state.
 */
export interface MatcherContext {
  /** Direction of the trip (TO_EVENT = inbound, FROM_EVENT = outbound) */
  tripDirection: TripDirection;
  
  /** Coordinates of the event location */
  eventLocation: Coordinates;
  
  /** When the event starts (used for inbound timing calculations) */
  eventStartTime?: Date;
  
  /** When the event ends (optional reference) */
  eventEndTime?: Date;
  
  /** Matching configuration settings */
  config: MatchingConfig;
  
  /**
   * Pre-calculated distances between all locations.
   * Key format: distanceMatrix.get(fromId).get(toId) = miles
   * Special key 'event' represents the event location.
   */
  distanceMatrix: Map<string, Map<string, number>>;
  
  /**
   * Each driver's direct distance (no passengers).
   * For outbound: Event → Driver Home
   * For inbound: Driver Home → Event
   */
  driverDirectDistances: Map<string, number>;
  
  /** Set of passenger IDs still available for assignment */
  availablePassengers: Set<string>;
  
  /** Remaining seats for each driver (driverId → seats) */
  availableSeats: Map<string, number>;
  
  /** Current assignments (driverId → [passengerId, ...]) */
  assignments: Map<string, string[]>;
}

// =============================================================================
// PASSENGER SCORE
// =============================================================================

/**
 * Result of scoring a passenger for a driver.
 * Includes breakdown by category for debugging/display.
 */
export interface PassengerScore {
  /** The passenger being scored */
  passenger: Passenger;
  
  /** Total weighted score (0.0 to 1.0) */
  score: number;
  
  /** Individual scores by category */
  breakdown: {
    routeEfficiency: number;
    detour: number;
    genderMatch: number;
    ageMatch: number;
    driverPreference: number;
  };
  
  /** How many extra miles this passenger adds to the route */
  detourMiles: number;
  
  /** Distance from route origin to this passenger */
  distanceFromStart: number;
}

// =============================================================================
// MATCHER INTERFACE
// =============================================================================

/**
 * Interface that all matchers must implement.
 */
export interface IMatcher {
  /** Unique name for this matcher (e.g., 'timing', 'capacity') */
  readonly name: string;
  
  /** Priority level (lower = runs first) */
  readonly priority: number;
  
  /**
   * Score a passenger for a specific driver.
   * 
   * @returns A score from 0.0 to 1.0 (higher = better match),
   *          or null if this matcher considers the match invalid.
   */
  scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null;
  
  /**
   * Filter passengers to only those valid for this driver.
   * Removes passengers that would return null from scorePassenger.
   */
  filterValidPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[];
  
  /**
   * Optional: Sort passengers by preference for this matcher.
   */
  sortPassengers?(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[];
}

// =============================================================================
// ABSTRACT BASE CLASS
// =============================================================================

/**
 * Abstract base class providing common functionality for matchers.
 * Concrete matchers extend this and implement scorePassenger().
 */
export abstract class BaseMatcher implements IMatcher {
  abstract readonly name: string;
  abstract readonly priority: number;
  
  /**
   * Score a passenger for a driver. Must be implemented by subclass.
   */
  abstract scorePassenger(
    passenger: Passenger,
    driver: Driver,
    context: MatcherContext
  ): number | null;
  
  /**
   * Default filter: keep passengers where scorePassenger returns non-null.
   */
  filterValidPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    return passengers.filter(p => {
      const score = this.scorePassenger(p, driver, context);
      return score !== null;
    });
  }
  
  /**
   * Default sort: by score descending.
   */
  sortPassengers(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): Passenger[] {
    return [...passengers].sort((a, b) => {
      const scoreA = this.scorePassenger(a, driver, context) ?? -Infinity;
      const scoreB = this.scorePassenger(b, driver, context) ?? -Infinity;
      return scoreB - scoreA; // Higher score first
    });
  }
  
  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================
  
  /**
   * Get distance between two locations (people or event).
   * 
   * @param fromId - ID of starting location (person ID or 'event')
   * @param toId - ID of destination (person ID or 'event')
   * @returns Distance in miles, or Infinity if not found
   */
  protected getDistance(
    fromId: string,
    toId: string,
    context: MatcherContext
  ): number {
    return context.distanceMatrix.get(fromId)?.get(toId) ?? Infinity;
  }
  
  /**
   * Get distance from a person's home to the event location.
   * 
   * @param personId - ID of the person
   * @returns Distance in miles from their home to the event
   */
  protected getDistanceFromEvent(
    personId: string,
    context: MatcherContext
  ): number {
    return context.distanceMatrix.get(personId)?.get('event') ?? Infinity;
  }
  
  /**
   * Get the route origin ID for a driver based on trip direction.
   * 
   * For OUTBOUND (FROM_EVENT): Origin is the event
   * For INBOUND (TO_EVENT): Origin is the driver's home
   */
  protected getRouteOriginId(driver: Driver, context: MatcherContext): string {
    return context.tripDirection === TripDirection.FROM_EVENT ? 'event' : driver.id;
  }
  
  /**
   * Get the route destination ID for a driver based on trip direction.
   * 
   * For OUTBOUND (FROM_EVENT): Destination is the driver's home
   * For INBOUND (TO_EVENT): Destination is the event
   */
  protected getRouteDestinationId(driver: Driver, context: MatcherContext): string {
    return context.tripDirection === TripDirection.FROM_EVENT ? driver.id : 'event';
  }
  
  /**
   * Get the driver's direct distance (without any passengers).
   * This is the baseline for calculating detour.
   */
  protected getDriverDirectDistance(driver: Driver, context: MatcherContext): number {
    return context.driverDirectDistances.get(driver.id) ?? Infinity;
  }
  
  /**
   * Normalize a value to a 0-1 range.
   * 
   * @param value - The value to normalize
   * @param min - Minimum expected value (maps to 0)
   * @param max - Maximum expected value (maps to 1)
   * @returns Normalized value clamped to [0, 1]
   */
  protected normalize(value: number, min: number, max: number): number {
    if (max === min) return 0.5;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }
  
  /**
   * Estimate travel time in minutes from distance.
   * Uses dynamic speed scaling based on distance.
   * 
   * @param distanceMiles - Distance to travel
   * @param context - Matching context with timing config
   * @returns Estimated travel time in minutes (with traffic buffer)
   */
  protected estimateTravelTime(distanceMiles: number, context: MatcherContext): number {
    const { trafficBufferMultiplier } = context.config.timing;
    
    // Dynamic speed based on distance
    let averageSpeedMph: number;
    if (distanceMiles < 5) {
      averageSpeedMph = 20; // City driving
    } else if (distanceMiles < 15) {
      averageSpeedMph = 35; // Mixed / Suburban
    } else {
      averageSpeedMph = 55; // Highway
    }
    
    const baseTimeMinutes = (distanceMiles / averageSpeedMph) * 60;
    return Math.ceil(baseTimeMinutes * trafficBufferMultiplier);
  }
}
