import { z } from 'zod';

// =============================================================================
// ENUMS & CONSTANTS
// =============================================================================

/**
 * Gender options for passengers and drivers.
 * Used for optional same-gender matching preferences.
 */
export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  NON_BINARY = 'non_binary',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say'
}

/**
 * Gender preference for ride matching.
 * SAME_GENDER: Passenger prefers a driver of the same gender (soft constraint)
 * ANY: No gender preference
 */
export enum GenderPreference {
  SAME_GENDER = 'same_gender',
  ANY = 'any'
}

/**
 * Status of a passenger's match assignment.
 */
export enum MatchStatus {
  MATCHED = 'matched',
  UNMATCHED = 'unmatched',
  MANUALLY_ASSIGNED = 'manually_assigned'
}

/**
 * Age group categories for grouping similar ages.
 * Used as a soft preference in matching.
 */
export enum AgeGroup {
  YOUNG_ADULT = 'young_adult',    // 18-25
  ADULT = 'adult',                // 26-40
  MIDDLE_AGED = 'middle_aged',    // 41-55
  SENIOR = 'senior'               // 56+
}

/**
 * Direction of the trip relative to the event.
 * 
 * TO_EVENT (Inbound): Driver picks up passengers from their homes
 *   and brings them to the event. Driver starts at their home.
 *   Route: Driver Home → Passenger A → Passenger B → Event
 * 
 * FROM_EVENT (Outbound): Driver takes passengers home after the event.
 *   Everyone starts at the event location.
 *   Route: Event → Passenger A → Passenger B → Driver Home
 */
export enum TripDirection {
  TO_EVENT = 'to_event',
  FROM_EVENT = 'from_event'
}

// =============================================================================
// LOCATION TYPES
// =============================================================================

/**
 * Geographic coordinates (latitude/longitude).
 */
export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Physical address.
 */
export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

/**
 * A location with both address and coordinates.
 * Coordinates are either provided or geocoded from the address.
 */
export interface GeocodedLocation {
  address: Address;
  coordinates: Coordinates;
  formattedAddress: string;
}

// =============================================================================
// PERSON BASE TYPES
// =============================================================================

/**
 * Base interface for both passengers and drivers.
 * Contains common fields like name, location, and timing preferences.
 */
export interface PersonBase {
  id: string;
  name: string;
  gender: Gender;
  age: number;
  homeAddress: Address;
  homeCoordinates?: Coordinates;  // Populated after geocoding
  checkedInAt?: Date;
  
  /**
   * For OUTBOUND trips: If true, this person needs to leave before
   * the event officially ends. They will only be matched with other
   * early-leaving drivers/passengers. This is a HARD constraint.
   */
  leavingEarly: boolean;
  
  /**
   * For OUTBOUND trips: The specific time this person needs to leave.
   * Only relevant if leavingEarly is true.
   */
  earlyDepartureTime?: Date;
}

// =============================================================================
// PASSENGER TYPES
// =============================================================================

/**
 * A person who needs a ride.
 */
export interface Passenger extends PersonBase {
  /** Whether this person needs a ride (false = they have their own transportation) */
  needsRide: boolean;
  
  /** Optional preference for same-gender driver */
  genderPreference: GenderPreference;
  
  // Future: Driver preference ranking
  // preferredDriverIds?: string[];
  // driverRankings?: { driverId: string; rank: number }[];
}

/**
 * A passenger who has been assigned to a ride group.
 * Includes their position in the route and timing information.
 */
export interface MatchedPassenger extends Passenger {
  /** Position in the route (1 = first stop, 2 = second, etc.) */
  stopOrder: number;
  
  /** Distance in miles from the route origin to this passenger */
  distanceFromOrigin: number;
  
  /** Additional miles this passenger adds to the driver's route */
  detourAdded: number;
  
  // ----- Outbound (FROM_EVENT) specific -----
  /** Same as stopOrder, for backward compatibility */
  dropOffOrder?: number;
  
  /** Estimated minutes from event end until drop-off */
  estimatedDropOffTime?: number;
  
  // ----- Inbound (TO_EVENT) specific -----
  /** Same as stopOrder, for clarity */
  pickupOrder?: number;
  
  /** 
   * The calculated time this passenger should be ready for pickup.
   * This is computed by the system based on the route - the passenger
   * does NOT set this. They simply need to be ready by this time.
   */
  shouldBeReadyBy?: Date;
  
  /** Minutes before event start when pickup occurs */
  estimatedPickupTime?: number;
}

// =============================================================================
// DRIVER TYPES
// =============================================================================

/**
 * A person who can give rides.
 */
export interface Driver extends PersonBase {
  /** Whether this person is available to drive */
  canDrive: boolean;
  
  /** Number of empty seats available for passengers */
  availableSeats: number;
  
  /** Optional vehicle information for identification */
  vehicleInfo?: {
    make?: string;
    model?: string;
    color?: string;
    licensePlate?: string;
  };
}

/**
 * A driver who has been assigned passengers.
 * Includes route information and timing.
 */
export interface MatchedDriver extends Driver {
  /** List of passengers assigned to this driver */
  assignedPassengers: MatchedPassenger[];
  
  /** Total miles for the complete route */
  totalRouteDistance: number;
  
  /** Extra miles beyond the direct route (route - direct) */
  totalDetour: number;
  
  /** Estimated total driving time in minutes */
  estimatedTotalTime?: number;
  
  /** Ordered list of coordinates for the route */
  routeWaypoints: Coordinates[];
  
  /** For inbound trips: when driver should leave home */
  departureTime?: Date;
}

// =============================================================================
// MATCHING RESULT TYPES
// =============================================================================

/**
 * A group of passengers assigned to one driver.
 * Represents a single carpool.
 */
export interface RideGroup {
  id: string;
  driver: MatchedDriver;
  passengers: MatchedPassenger[];
  
  /** Direction of this trip */
  tripDirection: TripDirection;
  
  createdAt: Date;
  lastModifiedAt: Date;
  
  /** True if an admin manually modified this group */
  isManuallyOverridden: boolean;
  
  /**
   * Schedule information for inbound trips.
   * Includes when the driver should leave and when to pick up each passenger.
   */
  schedule?: {
    driverDepartureTime: Date;
    pickupTimes: { passengerId: string; time: Date }[];
    estimatedArrivalTime: Date;
  };
}

/**
 * A passenger who could not be matched with any driver.
 */
export interface UnmatchedPassenger extends Passenger {
  /** Why this passenger couldn't be matched */
  reason: UnmatchedReason;
  
  /** Helpful suggestion for the passenger/organizer */
  suggestedAction?: string;
}

/**
 * Reasons why a passenger might not be matched.
 */
export enum UnmatchedReason {
  /** No drivers available at all */
  NO_AVAILABLE_DRIVERS = 'no_available_drivers',
  
  /** Passenger is too far out of the way for all drivers */
  EXCEEDS_DETOUR_LIMIT = 'exceeds_detour_limit',
  
  /** Passenger requires same-gender driver but none available */
  GENDER_PREFERENCE_UNMET = 'gender_preference_unmet',
  
  /** All vehicles are at capacity */
  NO_SEATS_AVAILABLE = 'no_seats_available',
  
  /** Passenger checked in too late to be assigned */
  CHECKED_IN_TOO_LATE = 'checked_in_too_late',
  
  /** Passenger leaving early but no early-leaving driver available */
  EARLY_DEPARTURE_MISMATCH = 'early_departure_mismatch',
  
  /** Inbound: passenger's location would require impossibly early pickup */
  CANNOT_ARRIVE_ON_TIME = 'cannot_arrive_on_time'
}

/**
 * The complete result of a matching operation.
 */
export interface MatchingResult {
  id: string;
  eventId: string;
  
  /** Direction of these trips */
  tripDirection: TripDirection;
  
  /** The event location (destination for inbound, origin for outbound) */
  startLocation: GeocodedLocation;
  
  /** When the event starts (used for inbound timing calculations) */
  eventStartTime?: Date;
  
  /** Successfully matched ride groups */
  rideGroups: RideGroup[];
  
  /** Passengers who could not be matched */
  unmatchedPassengers: UnmatchedPassenger[];
  
  /** Drivers who have no passengers assigned */
  unmatchedDrivers: Driver[];
  
  /** Statistics about the matching operation */
  metadata: {
    totalPassengers: number;
    totalDrivers: number;
    matchedPassengers: number;
    matchedDrivers: number;
    matchingDurationMs: number;
    algorithmVersion: string;
    priorityOrder: MatcherType[];
    tripDirection: TripDirection;
  };
  
  createdAt: Date;
  lastModifiedAt: Date;
}

// =============================================================================
// MATCHING CONFIGURATION
// =============================================================================

/**
 * Types of matchers that can be applied during matching.
 * Order determines priority (first = highest priority).
 */
export enum MatcherType {
  /** Hard constraint for timing (early departure, pickup times) */
  TIMING = 'timing',
  
  /** Groups early-leaving passengers with early-leaving drivers */
  EARLY_DEPARTURE = 'early_departure',
  
  /** Ensures vehicle has available seats */
  CAPACITY = 'capacity',
  
  /** Scores how "on the way" a passenger is for a driver */
  ROUTE_EFFICIENCY = 'route_efficiency',
  
  /** Future: passenger's preferred drivers */
  DRIVER_PREFERENCE = 'driver_preference',
  
  /** Minimizes extra driving time */
  DETOUR_TIME = 'detour_time',
  
  /** Respects gender matching preferences */
  GENDER = 'gender',
  
  /** Groups similar ages together */
  AGE = 'age'
}

/**
 * Configuration options for the matching algorithm.
 * Can be customized per-event or globally.
 */
export interface MatchingConfig {
  id: string;
  name: string;
  
  /** Order in which matchers are applied (first = highest priority) */
  priorityOrder: MatcherType[];
  
  /**
   * Maximum miles a driver can go out of their way.
   * For OUTBOUND: This is a SOFT limit - if needed to give everyone
   * a ride, it will be exceeded (passenger assigned to least-detour driver).
   * For INBOUND: This affects scoring but timing is the hard constraint.
   */
  maxDetourMiles: number;
  
  /** Maximum detour in minutes (optional, uses distance if not set) */
  maxDetourMinutes?: number;
  
  /**
   * Haversine pre-filter threshold.
   * Pairs beyond this crow-flies distance skip expensive API calls.
   */
  haversinePreFilterMiles: number;
  
  /** If true, gender preference is a hard constraint (default: soft) */
  enforceGenderPreference: boolean;
  
  /** Try to group passengers within this age range of the driver */
  groupByAgeRange: number;
  
  /** Timing settings for travel time calculations */
  timing: {
    /** Multiplier for traffic (1.3 = 30% buffer) */
    trafficBufferMultiplier: number;
    
    /** Minutes per passenger pickup/dropoff */
    loadTimeMinutes: number;
    
    /** Assumed average driving speed */
    averageSpeedMph: number;
  };
  
  /** Weights for scoring (0-1, should sum close to 1) */
  weights: {
    earlyDeparture: number;
    routeEfficiency: number;
    detour: number;
    genderMatch: number;
    ageMatch: number;
    driverPreference: number;
  };
  
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

/**
 * Request body for the /api/match endpoint.
 */
export interface MatchingRequest {
  /** Unique identifier for the event */
  eventId: string;
  
  /** Direction of the trip (required) */
  tripDirection: TripDirection;
  
  /** Location of the event */
  eventLocation: Address | Coordinates;
  
  /** All passengers who need rides */
  passengers: Passenger[];
  
  /** All available drivers */
  drivers: Driver[];
  
  /** When the event starts (required for TO_EVENT) */
  eventStartTime?: Date;
  
  /** When the event ends (optional, for reference) */
  eventEndTime?: Date;
  
  /** Use a specific saved configuration */
  configId?: string;
  
  /** Override specific config values for this request */
  configOverrides?: Partial<MatchingConfig>;
}

/**
 * Response from the /api/match endpoint.
 */
export interface MatchingResponse {
  success: boolean;
  result?: MatchingResult;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Request to manually modify a matching result.
 */
export interface OverrideRequest {
  matchingResultId: string;
  changes: {
    movePassenger?: {
      passengerId: string;
      fromGroupId: string;
      toGroupId: string;
      newStopOrder?: number;
    };
    removePassenger?: {
      passengerId: string;
      groupId: string;
      markAsUnmatched: boolean;
      reason?: string;
    };
    addPassenger?: {
      passengerId: string;
      groupId: string;
      stopOrder?: number;
    };
    swapPassengers?: {
      passenger1Id: string;
      group1Id: string;
      passenger2Id: string;
      group2Id: string;
    };
  };
  adminId: string;
  reason?: string;
}

// =============================================================================
// ZOD VALIDATION SCHEMAS
// =============================================================================

export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export const AddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().optional()
});

export const PassengerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  gender: z.nativeEnum(Gender),
  age: z.number().int().min(18).max(120),
  homeAddress: AddressSchema,
  homeCoordinates: CoordinatesSchema.optional(),
  needsRide: z.boolean(),
  genderPreference: z.nativeEnum(GenderPreference),
  checkedInAt: z.date().optional(),
  leavingEarly: z.boolean().default(false),
  earlyDepartureTime: z.date().optional()
});

export const DriverSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  gender: z.nativeEnum(Gender),
  age: z.number().int().min(18).max(120),
  homeAddress: AddressSchema,
  homeCoordinates: CoordinatesSchema.optional(),
  canDrive: z.boolean(),
  availableSeats: z.number().int().min(1).max(10),
  checkedInAt: z.date().optional(),
  leavingEarly: z.boolean().default(false),
  earlyDepartureTime: z.date().optional(),
  vehicleInfo: z.object({
    make: z.string().optional(),
    model: z.string().optional(),
    color: z.string().optional(),
    licensePlate: z.string().optional()
  }).optional()
});

export const MatchingRequestSchema = z.object({
  eventId: z.string().min(1),
  tripDirection: z.nativeEnum(TripDirection),
  eventLocation: z.union([AddressSchema, CoordinatesSchema]),
  passengers: z.array(PassengerSchema),
  drivers: z.array(DriverSchema),
  eventStartTime: z.date().optional(),
  eventEndTime: z.date().optional(),
  configId: z.string().optional(),
  configOverrides: z.record(z.unknown()).optional()
});

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Determine age group for a given age.
 * Used for grouping similar ages in matching.
 */
export function getAgeGroup(age: number): AgeGroup {
  if (age >= 18 && age <= 25) return AgeGroup.YOUNG_ADULT;
  if (age >= 26 && age <= 40) return AgeGroup.ADULT;
  if (age >= 41 && age <= 55) return AgeGroup.MIDDLE_AGED;
  return AgeGroup.SENIOR;
}

/**
 * Check if a driver's gender matches a passenger's preference.
 * Returns true if:
 * - Passenger has no preference (ANY)
 * - Either person prefers not to say (always matches)
 * - Genders are the same
 */
export function isGenderMatch(
  passengerGender: Gender,
  driverGender: Gender,
  preference: GenderPreference
): boolean {
  if (preference === GenderPreference.ANY) return true;
  if (passengerGender === Gender.PREFER_NOT_TO_SAY) return true;
  if (driverGender === Gender.PREFER_NOT_TO_SAY) return true;
  return passengerGender === driverGender;
}

/**
 * Calculate absolute age difference between two people.
 */
export function calculateAgeDifference(age1: number, age2: number): number {
  return Math.abs(age1 - age2);
}

/**
 * Calculate estimated travel time with Dynamic Speed Scaling
 * 
 * LOGIC:
 * - Short trips (<5 mi) are slow (City: ~20mph)
 * - Medium trips (5-15 mi) are mixed (Suburban: ~35mph)
 * - Long trips (>15 mi) are fast (Highway: ~55mph)
 */
export function estimateTravelTimeMinutes(
  distanceMiles: number,
  trafficBuffer: number = 1.3 // Safety margin
): number {
  let averageSpeedMph: number;
  if (distanceMiles < 5) {
    averageSpeedMph = 20; // City driving
  } else if (distanceMiles < 15) {
    averageSpeedMph = 35; // Mixed / Suburban
  } else {
    averageSpeedMph = 55; // Highway
  }
  const baseTimeMinutes = (distanceMiles / averageSpeedMph) * 60;
  
  // Return time with traffic buffer (e.g., adds 30% padding)
  return Math.ceil(baseTimeMinutes * trafficBuffer);
}
