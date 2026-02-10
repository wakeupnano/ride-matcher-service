/**
 * API Routes for Ride Matching
 * 
 * This file defines all the HTTP endpoints for the ride matching service:
 * 
 * GET  /api/health              - Health check (is the service running?)
 * POST /api/match               - Run the matching algorithm
 * GET  /api/match/:resultId     - Get a previous matching result
 * POST /api/match/:resultId/override - Manually modify a result
 * GET  /api/config              - List all configurations
 * GET  /api/config/:configId    - Get a specific configuration
 * PUT  /api/config/:configId    - Update a configuration
 * PUT  /api/config/:configId/priority - Update matcher priority order
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  MatchingRequest,
  MatchingResponse,
  OverrideRequest,
  MatchingResult,
  Address,
  Coordinates,
  GeocodedLocation,
  TripDirection
} from '../models/types';
import { MatchingEngine } from '../matchers/MatchingEngine';
import { configManager } from '../config/config';
import { GoogleMapsService, MockGeocodingService } from '../utils/geocoding';

const router = Router();

// =============================================================================
// SERVICE SETUP
// Choose between real Google Maps API or mock service based on environment.
// The mock service is useful for development/testing without API costs.
// =============================================================================

const geoService = process.env.GOOGLE_MAPS_API_KEY 
  ? new GoogleMapsService(process.env.GOOGLE_MAPS_API_KEY)
  : new MockGeocodingService();

const matchingEngine = new MatchingEngine(geoService);

// Simple in-memory storage for matching results.
// In production, this should be replaced with Firestore or another database.
const resultsStore = new Map<string, MatchingResult>();

// =============================================================================
// HEALTH CHECK ENDPOINT
// Used by monitoring systems to verify the service is running.
// =============================================================================

router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    version: '2.0.0',
    features: ['inbound', 'outbound', 'timing-constraints', 'dynamic-speed'],
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// MAIN MATCHING ENDPOINT
// This is the primary endpoint that clients call to match passengers to drivers.
// =============================================================================

router.post('/match', async (req: Request, res: Response) => {
  try {
    const request: MatchingRequest = req.body;
    
    // -------------------------------------------------------------------------
    // STEP 1: Validate the request
    // -------------------------------------------------------------------------
    
    // tripDirection is required - we need to know if this is inbound or outbound
    if (!request.tripDirection) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'tripDirection is required (TO_EVENT or FROM_EVENT)'
        }
      } as MatchingResponse);
    }
    
    // Make sure tripDirection is a valid value
    if (!Object.values(TripDirection).includes(request.tripDirection)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'tripDirection must be TO_EVENT or FROM_EVENT'
        }
      } as MatchingResponse);
    }
    
    // For inbound trips, we need to know when the event starts
    // so we can calculate pickup times working backward
    if (request.tripDirection === TripDirection.TO_EVENT && !request.eventStartTime) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'eventStartTime is required for inbound (TO_EVENT) trips'
        }
      } as MatchingResponse);
    }
    
    // -------------------------------------------------------------------------
    // STEP 2: Geocode the event location
    // Convert the address to coordinates if needed.
    // -------------------------------------------------------------------------
    
    let eventLocation: GeocodedLocation;
    
    // Check if they gave us an address or coordinates
    if ('street' in request.eventLocation) {
      // They gave us an address - need to geocode it
      eventLocation = await geoService.geocodeAddress(request.eventLocation as Address);
    } else {
      // They gave us coordinates - need to reverse geocode for the address
      const coords = request.eventLocation as Coordinates;
      eventLocation = await geoService.reverseGeocode(coords);
    }
    
    // -------------------------------------------------------------------------
    // STEP 3: Geocode passenger and driver home addresses
    // We need coordinates for everyone to calculate distances.
    // -------------------------------------------------------------------------
    
    const geocodedPassengers = await Promise.all(
      request.passengers.map(async (passenger) => {
        // Skip if they already have coordinates
        if (passenger.homeCoordinates) {
          return passenger;
        }
        
        // Try to geocode their address
        try {
          const geo = await geoService.geocodeAddress(passenger.homeAddress);
          return { ...passenger, homeCoordinates: geo.coordinates };
        } catch (error) {
          // If geocoding fails, log it but continue
          // They might still get matched if we have other data
          console.error(`Failed to geocode passenger ${passenger.id}:`, error);
          return passenger;
        }
      })
    );
    
    const geocodedDrivers = await Promise.all(
      request.drivers.map(async (driver) => {
        if (driver.homeCoordinates) {
          return driver;
        }
        
        try {
          const geo = await geoService.geocodeAddress(driver.homeAddress);
          return { ...driver, homeCoordinates: geo.coordinates };
        } catch (error) {
          console.error(`Failed to geocode driver ${driver.id}:`, error);
          return driver;
        }
      })
    );
    
    // -------------------------------------------------------------------------
    // STEP 4: Get the configuration
    // Use the requested config, or fall back to defaults.
    // -------------------------------------------------------------------------
    
    const config = configManager.getConfig(request.configId);
    
    // Apply any one-time overrides they specified
    const effectiveConfig = request.configOverrides 
      ? configManager.applyOverrides(config, request.configOverrides)
      : config;
    
    // -------------------------------------------------------------------------
    // STEP 5: Parse dates
    // Convert date strings to Date objects if needed.
    // -------------------------------------------------------------------------
    
    const eventStartTime = request.eventStartTime 
      ? new Date(request.eventStartTime) 
      : undefined;
      
    const eventEndTime = request.eventEndTime 
      ? new Date(request.eventEndTime) 
      : undefined;
    
    // -------------------------------------------------------------------------
    // STEP 6: Run the matching algorithm!
    // This is where the magic happens.
    // -------------------------------------------------------------------------
    
    const result = await matchingEngine.match(
      geocodedPassengers,
      geocodedDrivers,
      eventLocation,
      request.tripDirection,
      eventStartTime,
      eventEndTime,
      effectiveConfig
    );
    
    // Set the event ID on the result
    result.eventId = request.eventId;
    
    // Save the result so it can be retrieved later
    resultsStore.set(result.id, result);
    
    // -------------------------------------------------------------------------
    // STEP 7: Return the result
    // -------------------------------------------------------------------------
    
    return res.json({
      success: true,
      result
    } as MatchingResponse);
    
  } catch (error) {
    // Something went wrong - log it and return an error
    console.error('Matching error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'MATCHING_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    } as MatchingResponse);
  }
});

// =============================================================================
// GET MATCHING RESULT
// Retrieve a previously computed matching result by its ID.
// =============================================================================

router.get('/match/:resultId', (req: Request, res: Response) => {
  const { resultId } = req.params;
  const result = resultsStore.get(resultId);
  
  if (!result) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Matching result ${resultId} not found`
      }
    });
  }
  
  return res.json({
    success: true,
    result
  } as MatchingResponse);
});

// =============================================================================
// MANUAL OVERRIDE ENDPOINT
// Allows admins to manually adjust the matching results.
// For example: move a passenger to a different car, remove someone, etc.
// =============================================================================

router.post('/match/:resultId/override', async (req: Request, res: Response) => {
  try {
    const { resultId } = req.params;
    const overrideRequest: OverrideRequest = req.body;
    
    // Find the existing result
    const result = resultsStore.get(resultId);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Matching result ${resultId} not found`
        }
      });
    }
    
    // Apply the requested changes
    const updatedResult = applyOverrides(result, overrideRequest);
    updatedResult.lastModifiedAt = new Date();
    
    // Save the updated result
    resultsStore.set(resultId, updatedResult);
    
    return res.json({
      success: true,
      result: updatedResult
    } as MatchingResponse);
    
  } catch (error) {
    console.error('Override error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'OVERRIDE_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// =============================================================================
// CONFIGURATION ENDPOINTS
// Allow viewing and updating the matching configuration.
// =============================================================================

/**
 * List all available configurations.
 */
router.get('/config', (req: Request, res: Response) => {
  const configs = configManager.listConfigs();
  res.json({ success: true, configs });
});

/**
 * Get a specific configuration by ID.
 */
router.get('/config/:configId', (req: Request, res: Response) => {
  const { configId } = req.params;
  const config = configManager.getConfig(configId);
  res.json({ success: true, config });
});

/**
 * Update a configuration.
 */
router.put('/config/:configId', (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const updates = req.body;
    
    // Get the existing config and merge with updates
    const existingConfig = configManager.getConfig(configId);
    const updatedConfig = configManager.saveConfig({
      ...existingConfig,
      ...updates,
      id: configId  // Make sure ID doesn't change
    });
    
    res.json({ success: true, config: updatedConfig });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

/**
 * Update just the priority order of matchers.
 * This controls which matching criteria are considered first.
 */
router.put('/config/:configId/priority', (req: Request, res: Response) => {
  try {
    const { configId } = req.params;
    const { priorityOrder } = req.body;
    
    const updatedConfig = configManager.updatePriorityOrder(configId, priorityOrder);
    
    res.json({ success: true, config: updatedConfig });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Apply manual override changes to a matching result.
 * 
 * Supports the following operations:
 * - movePassenger: Move a passenger from one car to another
 * - removePassenger: Remove a passenger from a car
 * - swapPassengers: Swap two passengers between cars
 * 
 * @param result - The original matching result
 * @param overrideRequest - The changes to apply
 * @returns The updated matching result
 */
function applyOverrides(
  result: MatchingResult,
  overrideRequest: OverrideRequest
): MatchingResult {
  // Make a copy so we don't mutate the original
  const updatedResult = { ...result };
  const { changes } = overrideRequest;
  
  // ----- MOVE PASSENGER -----
  // Take a passenger from one car and put them in another
  if (changes.movePassenger) {
    const { passengerId, fromGroupId, toGroupId, newStopOrder } = changes.movePassenger;
    
    // Find the source and destination groups
    const fromGroup = updatedResult.rideGroups.find(g => g.id === fromGroupId);
    const toGroup = updatedResult.rideGroups.find(g => g.id === toGroupId);
    
    if (!fromGroup || !toGroup) {
      throw new Error('Invalid group ID');
    }
    
    // Find and remove the passenger from the source group
    const passengerIndex = fromGroup.passengers.findIndex(p => p.id === passengerId);
    if (passengerIndex === -1) {
      throw new Error('Passenger not found in source group');
    }
    
    const [passenger] = fromGroup.passengers.splice(passengerIndex, 1);
    fromGroup.driver.assignedPassengers = fromGroup.passengers;
    fromGroup.isManuallyOverridden = true;
    
    // Add to the destination group
    if (newStopOrder !== undefined) {
      passenger.stopOrder = newStopOrder;
    } else {
      passenger.stopOrder = toGroup.passengers.length + 1;
    }
    
    toGroup.passengers.push(passenger);
    toGroup.driver.assignedPassengers = toGroup.passengers;
    toGroup.isManuallyOverridden = true;
    
    // Renumber the stop orders to be sequential
    renumberStopOrders(fromGroup.passengers);
    renumberStopOrders(toGroup.passengers);
  }
  
  // ----- REMOVE PASSENGER -----
  // Take a passenger out of a car (maybe they found another ride)
  if (changes.removePassenger) {
    const { passengerId, groupId, markAsUnmatched, reason } = changes.removePassenger;
    
    const group = updatedResult.rideGroups.find(g => g.id === groupId);
    if (!group) {
      throw new Error('Invalid group ID');
    }
    
    const passengerIndex = group.passengers.findIndex(p => p.id === passengerId);
    if (passengerIndex === -1) {
      throw new Error('Passenger not found in group');
    }
    
    // Remove the passenger
    const [passenger] = group.passengers.splice(passengerIndex, 1);
    group.driver.assignedPassengers = group.passengers;
    group.isManuallyOverridden = true;
    
    // Optionally add them to the unmatched list
    if (markAsUnmatched) {
      updatedResult.unmatchedPassengers.push({
        ...passenger,
        reason: 'manual_removal' as any,
        suggestedAction: reason || 'Manually removed by admin'
      });
    }
    
    renumberStopOrders(group.passengers);
  }
  
  // ----- SWAP PASSENGERS -----
  // Exchange two passengers between cars
  if (changes.swapPassengers) {
    const { passenger1Id, group1Id, passenger2Id, group2Id } = changes.swapPassengers;
    
    const group1 = updatedResult.rideGroups.find(g => g.id === group1Id);
    const group2 = updatedResult.rideGroups.find(g => g.id === group2Id);
    
    if (!group1 || !group2) {
      throw new Error('Invalid group ID');
    }
    
    const p1Index = group1.passengers.findIndex(p => p.id === passenger1Id);
    const p2Index = group2.passengers.findIndex(p => p.id === passenger2Id);
    
    if (p1Index === -1 || p2Index === -1) {
      throw new Error('Passenger not found');
    }
    
    // Swap them
    const temp = group1.passengers[p1Index];
    group1.passengers[p1Index] = group2.passengers[p2Index];
    group2.passengers[p2Index] = temp;
    
    group1.isManuallyOverridden = true;
    group2.isManuallyOverridden = true;
    
    renumberStopOrders(group1.passengers);
    renumberStopOrders(group2.passengers);
  }
  
  return updatedResult;
}

/**
 * Renumber the stop orders to be sequential (1, 2, 3, ...).
 * Called after moving/removing passengers to keep orders clean.
 */
function renumberStopOrders(passengers: any[]): void {
  passengers.forEach((p, i) => {
    p.stopOrder = i + 1;
    
    // Also update the direction-specific order fields
    if (p.dropOffOrder !== undefined) {
      p.dropOffOrder = i + 1;
    }
    if (p.pickupOrder !== undefined) {
      p.pickupOrder = i + 1;
    }
  });
}

export default router;
