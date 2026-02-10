/**
 * MatchingEngine - Core Algorithm for Ride Matching
 * 
 * This is the main orchestrator that coordinates all the individual matchers
 * to produce optimal passenger-to-driver assignments.
 * 
 * KEY DESIGN DECISIONS:
 * 
 * 1. Direction-Aware: Same engine handles both inbound (TO_EVENT) and
 *    outbound (FROM_EVENT) trips by swapping origin/destination logic.
 * 
 * 2. Furthest Driver First: Drivers with longer routes are processed first
 *    because they have a larger "catchment area" for picking up passengers
 *    who happen to be on their way.
 * 
 * 3. Give Everyone a Ride (Outbound): For trips home from an event,
 *    the priority is ensuring everyone gets a ride, even if it means
 *    some drivers take longer detours. We assign remaining passengers
 *    to whichever driver has the LEAST additional detour.
 * 
 * 4. Timing Constraints (Inbound): For trips to an event, we calculate
 *    when each passenger needs to be ready (shouldBeReadyBy) rather than
 *    asking them to specify a ready time.
 * 
 * 5. Zero API Cost: Uses Haversine formula with road factor (1.4x) for
 *    all distance calculations. No Google Maps API calls during matching.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Passenger,
  Driver,
  MatchedPassenger,
  MatchedDriver,
  RideGroup,
  UnmatchedPassenger,
  UnmatchedReason,
  MatchingResult,
  MatchingConfig,
  Coordinates,
  GeocodedLocation,
  TripDirection,
  GenderPreference
} from '../models/types';
import { MatcherContext, PassengerScore } from './BaseMatcher';
import { createMatchers, MatcherMap, DetourMatcher, TimingMatcher } from './implementations';
import { GeocodingService, DistanceService, haversineDistance } from '../utils/geocoding';
import { DEFAULT_CONFIG } from '../config/config';

export class MatchingEngine {
  private matchers: MatcherMap;
  private geocodingService: GeocodingService & DistanceService;
  private config: MatchingConfig;
  
  constructor(
    geocodingService: GeocodingService & DistanceService,
    config?: MatchingConfig
  ) {
    this.matchers = createMatchers();
    this.geocodingService = geocodingService;
    this.config = config || DEFAULT_CONFIG;
  }
  
  // ===========================================================================
  // MAIN ENTRY POINT
  // ===========================================================================
  
  /**
   * Match passengers to drivers for a trip.
   * 
   * @param passengers - All passengers who need rides
   * @param drivers - All available drivers
   * @param eventLocation - Location of the event
   * @param tripDirection - TO_EVENT (inbound) or FROM_EVENT (outbound)
   * @param eventStartTime - When event starts (required for inbound)
   * @param eventEndTime - When event ends (optional)
   * @param configOverrides - Override default config for this request
   * 
   * @returns MatchingResult with ride groups and unmatched passengers
   */
  async match(
    passengers: Passenger[],
    drivers: Driver[],
    eventLocation: GeocodedLocation,
    tripDirection: TripDirection,
    eventStartTime?: Date,
    eventEndTime?: Date,
    configOverrides?: Partial<MatchingConfig>
  ): Promise<MatchingResult> {
    const startTime = Date.now();
    
    // Merge config with any overrides
    const effectiveConfig = configOverrides 
      ? { ...this.config, ...configOverrides }
      : this.config;
    
    // Validate: inbound trips need an event start time
    if (tripDirection === TripDirection.TO_EVENT && !eventStartTime) {
      throw new Error('eventStartTime is required for inbound (TO_EVENT) trips');
    }
    
    // Filter to active participants only
    const activePassengers = passengers.filter(p => p.needsRide);
    const activeDrivers = drivers.filter(d => d.canDrive && d.availableSeats > 0);
    
    console.log(`[MatchingEngine] Starting ${tripDirection} matching:`);
    console.log(`  - ${activePassengers.length} passengers need rides`);
    console.log(`  - ${activeDrivers.length} drivers available`);
    
    // Build the matching context (distance matrix, etc.)
    const context = await this.buildContext(
      activePassengers,
      activeDrivers,
      eventLocation,
      tripDirection,
      eventStartTime,
      eventEndTime,
      effectiveConfig
    );
    
    // Run the matching algorithm
    const { rideGroups, unmatchedPassengers, unmatchedDrivers } = 
      this.runMatching(activePassengers, activeDrivers, context);
    
    // Build and return the result
    return {
      id: uuidv4(),
      eventId: '',
      tripDirection,
      startLocation: eventLocation,
      eventStartTime,
      rideGroups,
      unmatchedPassengers,
      unmatchedDrivers,
      metadata: {
        totalPassengers: activePassengers.length,
        totalDrivers: activeDrivers.length,
        matchedPassengers: rideGroups.reduce((sum, g) => sum + g.passengers.length, 0),
        matchedDrivers: rideGroups.filter(g => g.passengers.length > 0).length,
        matchingDurationMs: Date.now() - startTime,
        algorithmVersion: '2.0.0',
        priorityOrder: effectiveConfig.priorityOrder,
        tripDirection
      },
      createdAt: new Date(),
      lastModifiedAt: new Date()
    };
  }
  
  // ===========================================================================
  // CONTEXT BUILDING
  // ===========================================================================
  
  /**
   * Build the matching context with all pre-calculated distances.
   * 
   * This creates:
   * - A distance matrix between all locations (event + all people's homes)
   * - Driver direct distances (their route without any passengers)
   * - Tracking structures for available passengers and seats
   */
  private async buildContext(
    passengers: Passenger[],
    drivers: Driver[],
    eventLocation: GeocodedLocation,
    tripDirection: TripDirection,
    eventStartTime: Date | undefined,
    eventEndTime: Date | undefined,
    config: MatchingConfig
  ): Promise<MatcherContext> {
    // Collect all coordinates
    const allPeople = [...passengers, ...drivers];
    const coordsMap = new Map<string, Coordinates>();
    
    // Event location is keyed as 'event'
    coordsMap.set('event', eventLocation.coordinates);
    
    // Add all people's home coordinates
    for (const person of allPeople) {
      if (person.homeCoordinates) {
        coordsMap.set(person.id, person.homeCoordinates);
      }
    }
    
    // Build distance matrix using Haversine (free, no API calls)
    const distanceMatrix = new Map<string, Map<string, number>>();
    const allIds = ['event', ...allPeople.map(p => p.id)];
    
    // Initialize and calculate all pairwise distances
    for (const fromId of allIds) {
      const fromCoord = coordsMap.get(fromId);
      const fromMap = new Map<string, number>();
      
      for (const toId of allIds) {
        if (fromId === toId) {
          fromMap.set(toId, 0);
          continue;
        }
        
        const toCoord = coordsMap.get(toId);
        if (fromCoord && toCoord) {
          // Haversine gives crow-flies distance
          // Multiply by 1.4 to estimate road distance
          const crowFlies = haversineDistance(fromCoord, toCoord);
          const roadDistance = crowFlies * 1.4;
          fromMap.set(toId, roadDistance);
        } else {
          fromMap.set(toId, Infinity);
        }
      }
      distanceMatrix.set(fromId, fromMap);
    }
    
    // Calculate each driver's direct distance (no passengers)
    // This is used to measure how much detour passengers add
    const driverDirectDistances = new Map<string, number>();
    for (const driver of drivers) {
      let distance: number;
      if (tripDirection === TripDirection.FROM_EVENT) {
        // Outbound: Event → Driver Home
        distance = distanceMatrix.get('event')?.get(driver.id) ?? Infinity;
      } else {
        // Inbound: Driver Home → Event
        distance = distanceMatrix.get(driver.id)?.get('event') ?? Infinity;
      }
      driverDirectDistances.set(driver.id, distance);
    }
    
    return {
      tripDirection,
      eventLocation: eventLocation.coordinates,
      eventStartTime,
      eventEndTime,
      config,
      distanceMatrix,
      driverDirectDistances,
      availablePassengers: new Set(passengers.map(p => p.id)),
      availableSeats: new Map(drivers.map(d => [d.id, d.availableSeats])),
      assignments: new Map(drivers.map(d => [d.id, []]))
    };
  }
  
  // ===========================================================================
  // MAIN MATCHING ALGORITHM
  // ===========================================================================
  
  /**
   * Run the matching algorithm.
   * 
   * Algorithm Overview:
   * 
   * 1. Sort drivers by distance (furthest first - larger catchment area)
   * 
   * 2. For OUTBOUND trips:
   *    a. Process early-leaving drivers first with early-leaving passengers
   *    b. Process normal drivers with normal passengers
   *    c. Run a "sweep" pass to ensure everyone gets a ride
   * 
   * 3. For INBOUND trips:
   *    a. Process all drivers (timing handled by TimingMatcher)
   * 
   * 4. Build ride groups with optimized stop order
   * 
   * 5. Collect any remaining unmatched passengers with reasons
   */
  private runMatching(
    passengers: Passenger[],
    drivers: Driver[],
    context: MatcherContext
  ): {
    rideGroups: RideGroup[];
    unmatchedPassengers: UnmatchedPassenger[];
    unmatchedDrivers: Driver[];
  } {
    const passengerMap = new Map(passengers.map(p => [p.id, p]));
    
    // Sort drivers: FURTHEST FIRST, then prefer drivers who match passengers' gender preference
    // When distances are equal, process same-gender drivers first so passengers with
    // SAME_GENDER preference get matched to them
    const sortedDrivers = [...drivers].sort((a, b) => {
      const distA = context.driverDirectDistances.get(a.id) ?? 0;
      const distB = context.driverDirectDistances.get(b.id) ?? 0;
      if (distB !== distA) return distB - distA; // Descending (furthest first)
      // Tiebreaker: prefer driver whose gender matches more passengers with SAME_GENDER preference
      const passengersWithSameGenderPref = passengers.filter(
        p => p.genderPreference === GenderPreference.SAME_GENDER
      );
      const matchCountA = passengersWithSameGenderPref.filter(p => p.gender === a.gender).length;
      const matchCountB = passengersWithSameGenderPref.filter(p => p.gender === b.gender).length;
      return matchCountB - matchCountA; // Higher match count first
    });
    
    console.log(`[MatchingEngine] Driver processing order (furthest first):`);
    sortedDrivers.forEach((d, i) => {
      const dist = context.driverDirectDistances.get(d.id)?.toFixed(1) ?? '?';
      console.log(`  ${i + 1}. ${d.name}: ${dist} miles`);
    });
    
    // -------------------------------------------------------------------------
    // PHASE 1: Standard matching with scoring
    // -------------------------------------------------------------------------
    
    if (context.tripDirection === TripDirection.FROM_EVENT) {
      // Outbound: Handle early-leaving separately
      const earlyDrivers = sortedDrivers.filter(d => d.leavingEarly);
      const normalDrivers = sortedDrivers.filter(d => !d.leavingEarly);
      
      console.log(`[MatchingEngine] Phase 1a: Early drivers (${earlyDrivers.length})`);
      for (const driver of earlyDrivers) {
        this.assignPassengersToDriver(driver, passengerMap, context, true);
      }
      
      console.log(`[MatchingEngine] Phase 1b: Normal drivers (${normalDrivers.length})`);
      for (const driver of normalDrivers) {
        this.assignPassengersToDriver(driver, passengerMap, context, false);
      }
      
      // ---------------------------------------------------------------------
      // PHASE 2: Ensure everyone gets a ride (outbound only)
      // ---------------------------------------------------------------------
      // If passengers remain unmatched and drivers have seats, assign them
      // to whichever driver has the LEAST detour, regardless of limit
      console.log(`[MatchingEngine] Phase 2: Sweep pass for remaining passengers`);
      this.assignRemainingPassengers(passengerMap, normalDrivers, context);
      
    } else {
      // Inbound: Process all drivers
      console.log(`[MatchingEngine] Processing all drivers for inbound`);
      for (const driver of sortedDrivers) {
        this.assignPassengersToDriver(driver, passengerMap, context, false);
      }
    }
    
    // -------------------------------------------------------------------------
    // PHASE 3: Build ride groups from assignments (one group per driver, including empty)
    // -------------------------------------------------------------------------
    
    const rideGroups: RideGroup[] = [];
    const unmatchedDrivers: Driver[] = [];
    
    for (const driver of drivers) {
      const assignedIds = context.assignments.get(driver.id) || [];
      
      // Build passengers with optimized stop order (empty if none assigned)
      const matchedPassengers = assignedIds.length > 0
        ? this.buildStopOrder(
            assignedIds.map(id => passengerMap.get(id)!),
            driver,
            context
          )
        : [];
      
      if (assignedIds.length === 0) {
        unmatchedDrivers.push(driver);
      }
      
      // Build the driver info (even for drivers with 0 passengers)
      const matchedDriver: MatchedDriver = {
        ...driver,
        assignedPassengers: matchedPassengers,
        totalRouteDistance: this.calculateTotalRoute(matchedPassengers, driver, context),
        totalDetour: this.calculateTotalDetour(matchedPassengers, driver, context),
        routeWaypoints: this.buildWaypoints(matchedPassengers, driver, context),
        departureTime: context.tripDirection === TripDirection.TO_EVENT && matchedPassengers.length > 0
          ? this.calculateDriverDepartureTime(matchedPassengers, driver, context)
          : undefined
      };
      
      // Build schedule for inbound trips (only when driver has passengers)
      const schedule = context.tripDirection === TripDirection.TO_EVENT && matchedPassengers.length > 0
        ? this.buildInboundSchedule(matchedPassengers, driver, context)
        : undefined;
      
      rideGroups.push({
        id: uuidv4(),
        driver: matchedDriver,
        passengers: matchedPassengers,
        tripDirection: context.tripDirection,
        createdAt: new Date(),
        lastModifiedAt: new Date(),
        isManuallyOverridden: false,
        schedule
      });
    }
    
    // -------------------------------------------------------------------------
    // PHASE 4: Collect unmatched passengers
    // -------------------------------------------------------------------------
    
    const unmatchedPassengers: UnmatchedPassenger[] = [];
    for (const passengerId of context.availablePassengers) {
      const passenger = passengerMap.get(passengerId)!;
      unmatchedPassengers.push({
        ...passenger,
        reason: this.determineUnmatchedReason(passenger, drivers, context),
        suggestedAction: this.getSuggestedAction(passenger, drivers, context)
      });
    }
    
    console.log(`[MatchingEngine] Results:`);
    console.log(`  - ${rideGroups.length} ride groups created`);
    console.log(`  - ${unmatchedPassengers.length} passengers unmatched`);
    console.log(`  - ${unmatchedDrivers.length} drivers with no passengers`);
    
    return { rideGroups, unmatchedPassengers, unmatchedDrivers };
  }
  
  // ===========================================================================
  // PASSENGER ASSIGNMENT
  // ===========================================================================
  
  /**
   * Assign passengers to a single driver using scoring.
   * 
   * For each driver:
   * 1. Get all available passengers
   * 2. Score each passenger using all matchers
   * 3. Sort by score (highest first)
   * 4. Assign top-scoring passengers up to seat limit
   */
  private assignPassengersToDriver(
    driver: Driver,
    passengerMap: Map<string, Passenger>,
    context: MatcherContext,
    earlyOnly: boolean
  ): void {
    const remainingSeats = context.availableSeats.get(driver.id) ?? 0;
    if (remainingSeats <= 0) return;
    
    // Get available passengers
    let availablePassengers = Array.from(context.availablePassengers)
      .map(id => passengerMap.get(id)!)
      .filter(Boolean);
    
    // For early drivers in outbound, only consider early passengers
    if (earlyOnly && context.tripDirection === TripDirection.FROM_EVENT) {
      availablePassengers = availablePassengers.filter(p => p.leavingEarly);
    }
    
    if (availablePassengers.length === 0) return;
    
    // Score all available passengers
    const scores = this.scorePassengersForDriver(availablePassengers, driver, context);
    
    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    
    // Assign top-scoring passengers up to seat limit
    let seatsUsed = 0;
    for (const scored of scores) {
      if (seatsUsed >= remainingSeats) break;
      if (scored.score <= 0) break;
      
      // For outbound, skip detour check (we want everyone to get a ride)
      // For inbound, still check detour limit
      if (context.tripDirection === TripDirection.TO_EVENT) {
        const currentAssignments = context.assignments.get(driver.id) || [];
        const detourMatcher = this.matchers.detour_time as DetourMatcher;
        const newDetour = detourMatcher.calculateTotalDetour(
          driver,
          [...currentAssignments, scored.passenger.id],
          context
        );
        if (newDetour > context.config.maxDetourMiles) continue;
      }
      
      // Assign the passenger
      context.assignments.get(driver.id)?.push(scored.passenger.id);
      context.availablePassengers.delete(scored.passenger.id);
      seatsUsed++;
    }
    
    // Update remaining seats
    context.availableSeats.set(driver.id, remainingSeats - seatsUsed);
  }
  
  /**
   * Assign remaining passengers to any driver with seats (outbound only).
   * 
   * This ensures everyone gets a ride home, even if it means some
   * drivers take significant detours. Each remaining passenger is
   * assigned to whichever driver has the LEAST additional detour.
   */
  private assignRemainingPassengers(
    passengerMap: Map<string, Passenger>,
    drivers: Driver[],
    context: MatcherContext
  ): void {
    // Get passengers who still need rides (excluding early-leavers who couldn't be matched)
    const remainingPassengerIds = Array.from(context.availablePassengers)
      .filter(id => {
        const p = passengerMap.get(id);
        // Skip early-leavers - they can only ride with early drivers
        return p && !p.leavingEarly;
      });
    
    if (remainingPassengerIds.length === 0) return;
    
    console.log(`[MatchingEngine] ${remainingPassengerIds.length} passengers need sweep assignment`);
    
    // For each remaining passenger, find the driver with least detour
    for (const passengerId of remainingPassengerIds) {
      const passenger = passengerMap.get(passengerId)!;
      
      // Find driver with available seats and minimum detour
      let bestDriver: Driver | null = null;
      let bestDetour = Infinity;
      
      for (const driver of drivers) {
        const seats = context.availableSeats.get(driver.id) ?? 0;
        if (seats <= 0) continue;
        
        // Calculate detour if we add this passenger
        const currentAssignments = context.assignments.get(driver.id) || [];
        const detourMatcher = this.matchers.detour_time as DetourMatcher;
        const detour = detourMatcher.calculateTotalDetour(
          driver,
          [...currentAssignments, passengerId],
          context
        );
        
        if (detour < bestDetour) {
          bestDetour = detour;
          bestDriver = driver;
        }
      }
      
      // Assign to best driver (if found)
      if (bestDriver) {
        console.log(`  - ${passenger.name} → ${bestDriver.name} (${bestDetour.toFixed(1)} mi detour)`);
        context.assignments.get(bestDriver.id)?.push(passengerId);
        context.availablePassengers.delete(passengerId);
        const seats = context.availableSeats.get(bestDriver.id) ?? 0;
        context.availableSeats.set(bestDriver.id, seats - 1);
      }
    }
  }
  
  // ===========================================================================
  // SCORING
  // ===========================================================================
  
  /**
   * Score all passengers for a driver using all matchers.
   * 
   * Each matcher returns a score from 0-1 (or null if invalid).
   * Scores are weighted according to config and summed.
   */
  private scorePassengersForDriver(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): PassengerScore[] {
    const weights = context.config.weights;
    const scores: PassengerScore[] = [];
    
    for (const passenger of passengers) {
      // Check hard constraints first (timing)
      const timingScore = this.matchers.timing.scorePassenger(passenger, driver, context);
      if (timingScore === null) continue;
      
      // Check other matchers
      const routeScore = this.matchers.route_efficiency.scorePassenger(passenger, driver, context);
      if (routeScore === null) continue;
      
      const detourScore = this.matchers.detour_time.scorePassenger(passenger, driver, context);
      // For outbound, don't skip on detour (soft constraint)
      const effectiveDetourScore = detourScore ?? 0.1;
      
      const genderScore = this.matchers.gender.scorePassenger(passenger, driver, context);
      if (genderScore === null) continue;
      
      const ageScore = this.matchers.age.scorePassenger(passenger, driver, context) ?? 0.5;
      const prefScore = this.matchers.driver_preference.scorePassenger(passenger, driver, context) ?? 0.5;
      
      // Build score breakdown
      const breakdown = {
        routeEfficiency: routeScore,
        detour: effectiveDetourScore,
        genderMatch: genderScore,
        ageMatch: ageScore,
        driverPreference: prefScore
      };
      
      // Calculate weighted total
      const totalScore = 
        breakdown.routeEfficiency * weights.routeEfficiency +
        breakdown.detour * weights.detour +
        breakdown.genderMatch * weights.genderMatch +
        breakdown.ageMatch * weights.ageMatch +
        breakdown.driverPreference * weights.driverPreference;
      
      scores.push({
        passenger,
        score: totalScore,
        breakdown,
        detourMiles: 0, // Calculated later if needed
        distanceFromStart: context.distanceMatrix.get('event')?.get(passenger.id) ?? Infinity
      });
    }
    
    return scores;
  }
  
  // ===========================================================================
  // STOP ORDER OPTIMIZATION
  // ===========================================================================
  
  /**
   * Build optimal stop order using nearest-neighbor heuristic.
   * 
   * Starting from the origin (event for outbound, driver home for inbound),
   * repeatedly visit the nearest unvisited passenger.
   * 
   * This isn't globally optimal but is fast and produces good results.
   */
  private buildStopOrder(
    passengers: Passenger[],
    driver: Driver,
    context: MatcherContext
  ): MatchedPassenger[] {
    if (passengers.length === 0) return [];
    
    const ordered: Passenger[] = [];
    const remaining = new Set(passengers.map(p => p.id));
    const isOutbound = context.tripDirection === TripDirection.FROM_EVENT;
    
    // Starting point depends on direction
    let currentLocation = isOutbound ? 'event' : driver.id;
    
    // Greedy nearest-neighbor
    while (remaining.size > 0) {
      let nearest: Passenger | null = null;
      let nearestDistance = Infinity;
      
      for (const passengerId of remaining) {
        const distance = context.distanceMatrix.get(currentLocation)?.get(passengerId) ?? Infinity;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = passengers.find(p => p.id === passengerId) ?? null;
        }
      }
      
      if (nearest) {
        ordered.push(nearest);
        remaining.delete(nearest.id);
        currentLocation = nearest.id;
      } else {
        break;
      }
    }
    
    // Build MatchedPassenger objects with calculated fields
    let cumulativeDistance = 0;
    let previousLocation = isOutbound ? 'event' : driver.id;
    
    return ordered.map((p, index) => {
      const distanceFromPrevious = context.distanceMatrix.get(previousLocation)?.get(p.id) ?? 0;
      cumulativeDistance += distanceFromPrevious;
      previousLocation = p.id;
      
      // Calculate timing for inbound trips
      const shouldBeReadyBy = !isOutbound 
        ? this.calculatePassengerReadyTime(p, ordered, index, driver, context)
        : undefined;
      
      return {
        ...p,
        stopOrder: index + 1,
        dropOffOrder: isOutbound ? index + 1 : undefined,
        pickupOrder: !isOutbound ? index + 1 : undefined,
        distanceFromOrigin: cumulativeDistance,
        detourAdded: distanceFromPrevious,
        shouldBeReadyBy
      };
    });
  }
  
  // ===========================================================================
  // TIMING CALCULATIONS
  // ===========================================================================
  
  /**
   * Calculate when a passenger should be ready for pickup (inbound).
   * 
   * This works backward from the event start time:
   * 1. Calculate when the car will arrive at this passenger's home
   * 2. That's when they need to be ready
   * 
   * The passenger doesn't set this - we TELL them when to be ready.
   */
  private calculatePassengerReadyTime(
    passenger: Passenger,
    allPassengers: Passenger[],
    orderIndex: number,
    driver: Driver,
    context: MatcherContext
  ): Date | undefined {
    if (!context.eventStartTime) return undefined;
    
    const { trafficBufferMultiplier, loadTimeMinutes } = context.config.timing;
    const eventStart = context.eventStartTime.getTime();
    
    // Calculate distance from this passenger to event (via remaining passengers)
    let distanceToEvent = 0;
    let current = passenger.id;
    
    // Add distance through remaining passengers
    for (let i = orderIndex + 1; i < allPassengers.length; i++) {
      distanceToEvent += context.distanceMatrix.get(current)?.get(allPassengers[i].id) ?? 0;
      current = allPassengers[i].id;
    }
    
    // Add final leg to event
    distanceToEvent += context.distanceMatrix.get(current)?.get('event') ?? 0;
    
    // Dynamic speed based on distance
    const averageSpeedMph = this.getDynamicSpeed(distanceToEvent);
    
    // Calculate travel time
    const travelTimeMin = (distanceToEvent / averageSpeedMph) * 60 * trafficBufferMultiplier;
    
    // Account for loading remaining passengers
    const remainingPickups = allPassengers.length - orderIndex - 1;
    const loadBuffer = remainingPickups * loadTimeMinutes;
    
    // Ready time = Event Start - Travel Time - Load Time
    const readyTimeMs = eventStart - (travelTimeMin * 60000) - (loadBuffer * 60000);
    
    return new Date(readyTimeMs);
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
   * Calculate when driver should leave home (inbound).
   */
  private calculateDriverDepartureTime(
    passengers: MatchedPassenger[],
    driver: Driver,
    context: MatcherContext
  ): Date | undefined {
    if (!context.eventStartTime || passengers.length === 0) return undefined;
    
    const { trafficBufferMultiplier, loadTimeMinutes } = context.config.timing;
    const eventStart = context.eventStartTime.getTime();
    
    // Calculate total route distance
    const totalRoute = this.calculateTotalRoute(passengers, driver, context);
    
    // Dynamic speed based on total route distance
    const averageSpeedMph = this.getDynamicSpeed(totalRoute);
    
    // Calculate travel time
    const travelTimeMin = (totalRoute / averageSpeedMph) * 60 * trafficBufferMultiplier;
    
    // Add load time for each pickup
    const totalLoadTime = passengers.length * loadTimeMinutes;
    
    // Add safety buffer
    const safetyBuffer = 10;
    
    const departureTimeMs = eventStart 
      - (travelTimeMin * 60000) 
      - (totalLoadTime * 60000) 
      - (safetyBuffer * 60000);
    
    return new Date(departureTimeMs);
  }
  
  /**
   * Build complete schedule for inbound trip.
   */
  private buildInboundSchedule(
    passengers: MatchedPassenger[],
    driver: Driver,
    context: MatcherContext
  ): RideGroup['schedule'] | undefined {
    if (!context.eventStartTime) return undefined;
    
    const driverDepartureTime = this.calculateDriverDepartureTime(passengers, driver, context);
    if (!driverDepartureTime) return undefined;
    
    const pickupTimes = passengers.map(p => ({
      passengerId: p.id,
      time: p.shouldBeReadyBy || new Date()
    }));
    
    // Estimate arrival 5 minutes before event starts
    const estimatedArrivalTime = new Date(context.eventStartTime.getTime() - 5 * 60000);
    
    return {
      driverDepartureTime,
      pickupTimes,
      estimatedArrivalTime
    };
  }
  
  // ===========================================================================
  // HELPER CALCULATIONS
  // ===========================================================================
  
  /**
   * Calculate total route distance for a driver with passengers.
   */
  private calculateTotalRoute(
    passengers: MatchedPassenger[],
    driver: Driver,
    context: MatcherContext
  ): number {
    if (passengers.length === 0) {
      return context.driverDirectDistances.get(driver.id) ?? 0;
    }
    
    let total = 0;
    const isOutbound = context.tripDirection === TripDirection.FROM_EVENT;
    let current = isOutbound ? 'event' : driver.id;
    
    // Add each leg to passengers
    for (const p of passengers) {
      total += context.distanceMatrix.get(current)?.get(p.id) ?? 0;
      current = p.id;
    }
    
    // Add final leg to destination
    const destination = isOutbound ? driver.id : 'event';
    total += context.distanceMatrix.get(current)?.get(destination) ?? 0;
    
    return total;
  }
  
  /**
   * Calculate total detour (route distance minus direct distance).
   */
  private calculateTotalDetour(
    passengers: MatchedPassenger[],
    driver: Driver,
    context: MatcherContext
  ): number {
    const totalRoute = this.calculateTotalRoute(passengers, driver, context);
    const directDistance = context.driverDirectDistances.get(driver.id) ?? 0;
    return Math.max(0, totalRoute - directDistance);
  }
  
  /**
   * Build list of waypoints for the route (for map display).
   */
  private buildWaypoints(
    passengers: MatchedPassenger[],
    driver: Driver,
    context: MatcherContext
  ): Coordinates[] {
    const waypoints: Coordinates[] = [];
    const isOutbound = context.tripDirection === TripDirection.FROM_EVENT;
    
    if (isOutbound) {
      // Outbound: Event → Passengers → Driver Home
      waypoints.push(context.eventLocation);
      for (const p of passengers) {
        if (p.homeCoordinates) waypoints.push(p.homeCoordinates);
      }
      if (driver.homeCoordinates) waypoints.push(driver.homeCoordinates);
    } else {
      // Inbound: Driver Home → Passengers → Event
      if (driver.homeCoordinates) waypoints.push(driver.homeCoordinates);
      for (const p of passengers) {
        if (p.homeCoordinates) waypoints.push(p.homeCoordinates);
      }
      waypoints.push(context.eventLocation);
    }
    
    return waypoints;
  }
  
  // ===========================================================================
  // UNMATCHED HANDLING
  // ===========================================================================
  
  /**
   * Determine why a passenger couldn't be matched.
   */
  private determineUnmatchedReason(
    passenger: Passenger,
    drivers: Driver[],
    context: MatcherContext
  ): UnmatchedReason {
    // Check early departure mismatch (outbound)
    if (context.tripDirection === TripDirection.FROM_EVENT && passenger.leavingEarly) {
      const earlyDrivers = drivers.filter(d => d.leavingEarly);
      if (earlyDrivers.length === 0) {
        return UnmatchedReason.EARLY_DEPARTURE_MISMATCH;
      }
    }
    
    // Check seats
    const totalSeats = drivers.reduce((sum, d) => sum + (context.availableSeats.get(d.id) ?? 0), 0);
    if (totalSeats === 0) {
      return UnmatchedReason.NO_SEATS_AVAILABLE;
    }
    
    // Check gender (only if enforced)
    if (context.config.enforceGenderPreference && 
        passenger.genderPreference === GenderPreference.SAME_GENDER) {
      const matchingDrivers = drivers.filter(d => 
        d.gender === passenger.gender && (context.availableSeats.get(d.id) ?? 0) > 0
      );
      if (matchingDrivers.length === 0) {
        return UnmatchedReason.GENDER_PREFERENCE_UNMET;
      }
    }
    
    return UnmatchedReason.NO_AVAILABLE_DRIVERS;
  }
  
  /**
   * Get a helpful suggestion for unmatched passengers.
   */
  private getSuggestedAction(
    passenger: Passenger,
    drivers: Driver[],
    context: MatcherContext
  ): string {
    const reason = this.determineUnmatchedReason(passenger, drivers, context);
    
    switch (reason) {
      case UnmatchedReason.EARLY_DEPARTURE_MISMATCH:
        return 'No drivers are leaving early. Please find another early-leaving driver or arrange a rideshare.';
      case UnmatchedReason.NO_SEATS_AVAILABLE:
        return 'All vehicles are full. An additional driver is needed.';
      case UnmatchedReason.GENDER_PREFERENCE_UNMET:
        return 'No same-gender driver available with seats. Consider adjusting preference or arranging alternative transportation.';
      default:
        return 'Please arrange alternative transportation (rideshare, etc.)';
    }
  }
}

// Re-export for convenience
export { MatcherContext, PassengerScore } from './BaseMatcher';
