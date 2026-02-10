/**
 * Geocoding Utilities
 * 
 * This file handles all location-related calculations and API calls:
 * - Converting addresses to coordinates (geocoding)
 * - Converting coordinates to addresses (reverse geocoding)
 * - Calculating distances between locations
 * - Haversine formula for crow-flies distance (free, no API needed)
 * 
 * Two implementations are provided:
 * 1. GoogleMapsService - Uses @googlemaps/google-maps-services-js (requires API key)
 * 2. MockGeocodingService - Returns fake data for testing (no API needed)
 */

import { Client, Status } from '@googlemaps/google-maps-services-js';
import { Address, Coordinates, GeocodedLocation } from '../models/types';

// =============================================================================
// SERVICE INTERFACES
// These define what any geocoding service must be able to do.
// =============================================================================

/**
 * Any service that can convert addresses to/from coordinates.
 */
export interface GeocodingService {
  geocodeAddress(address: Address): Promise<GeocodedLocation>;
  reverseGeocode(coordinates: Coordinates): Promise<GeocodedLocation>;
}

/**
 * The result of a distance calculation between two points.
 */
export interface DistanceResult {
  origin: Coordinates;
  destination: Coordinates;
  distanceMiles: number;
  durationMinutes: number;
}

/**
 * Any service that can calculate distances between locations.
 */
export interface DistanceService {
  getDistance(origin: Coordinates, destination: Coordinates): Promise<DistanceResult>;
  getDistanceMatrix(origins: Coordinates[], destinations: Coordinates[]): Promise<DistanceResult[][]>;
}

// =============================================================================
// HAVERSINE FORMULA
// Calculates the "as the crow flies" distance between two points on Earth.
// This is FREE (no API calls) but doesn't account for roads.
// Multiply by ~1.4 to estimate actual driving distance.
// =============================================================================

/**
 * Calculate the straight-line distance between two coordinates.
 * Uses the Haversine formula which accounts for Earth's curvature.
 * 
 * @param coord1 - Starting point (lat/lng)
 * @param coord2 - Ending point (lat/lng)
 * @returns Distance in miles (straight line, not road distance)
 * 
 * @example
 * const distance = haversineDistance(
 *   { lat: 37.7749, lng: -122.4194 },  // San Francisco
 *   { lat: 37.8044, lng: -122.2712 }   // Oakland
 * );
 * // Returns ~8.5 miles (crow flies)
 * // Actual driving distance is closer to 12 miles
 */
export function haversineDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 3959; // Earth's radius in miles
  
  // Convert degrees to radians
  const lat1Rad = coord1.lat * Math.PI / 180;
  const lat2Rad = coord2.lat * Math.PI / 180;
  const deltaLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const deltaLng = (coord2.lng - coord1.lng) * Math.PI / 180;
  
  // Haversine formula
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

// =============================================================================
// GOOGLE MAPS SERVICE
// Uses the official @googlemaps/google-maps-services-js client.
// Requires a valid API key with Geocoding and Distance Matrix APIs enabled.
// =============================================================================

export class GoogleMapsService implements GeocodingService, DistanceService {
  private client: Client;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new Client();
  }

  /**
   * Convert a street address to coordinates.
   */
  async geocodeAddress(address: Address): Promise<GeocodedLocation> {
    const addressString = `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`;

    const res = await this.client.geocode({
      params: { address: addressString, key: this.apiKey },
    });

    if (res.data.status !== Status.OK || !res.data.results?.[0]) {
      throw new Error(
        `Geocoding failed: ${res.data.status} - ${res.data.error_message || 'No results found'}`
      );
    }

    const result = res.data.results[0];
    const addressComponents = this.parseAddressComponents(result.address_components ?? []);

    return {
      address: addressComponents,
      coordinates: {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      },
      formattedAddress: result.formatted_address,
    };
  }

  /**
   * Convert coordinates to a street address.
   */
  async reverseGeocode(coordinates: Coordinates): Promise<GeocodedLocation> {
    const res = await this.client.reverseGeocode({
      params: { latlng: coordinates, key: this.apiKey },
    });

    if (res.data.status !== Status.OK || !res.data.results?.[0]) {
      throw new Error(`Reverse geocoding failed: ${res.data.status}`);
    }

    const result = res.data.results[0];
    const addressComponents = this.parseAddressComponents(result.address_components ?? []);

    return {
      address: addressComponents,
      coordinates,
      formattedAddress: result.formatted_address,
    };
  }

  /**
   * Get driving distance and time between two points.
   */
  async getDistance(origin: Coordinates, destination: Coordinates): Promise<DistanceResult> {
    const matrix = await this.getDistanceMatrix([origin], [destination]);
    return matrix[0][0];
  }

  /**
   * Get distances between multiple origins and destinations.
   */
  async getDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<DistanceResult[][]> {
    const res = await this.client.distancematrix({
      params: {
        origins,
        destinations,
        key: this.apiKey,
      },
    });

    if (res.data.status !== Status.OK || !res.data.rows) {
      throw new Error(`Distance matrix failed: ${res.data.status}`);
    }

    const results: DistanceResult[][] = [];

    for (let i = 0; i < origins.length; i++) {
      results[i] = [];
      const row = res.data.rows[i];

      for (let j = 0; j < destinations.length; j++) {
        const element = row.elements[j];

        if (element.status === Status.OK) {
          results[i][j] = {
            origin: origins[i],
            destination: destinations[j],
            distanceMiles: (element.distance?.value ?? 0) / 1609.34,
            durationMinutes: (element.duration?.value ?? 0) / 60,
          };
        } else {
          results[i][j] = {
            origin: origins[i],
            destination: destinations[j],
            distanceMiles: Infinity,
            durationMinutes: Infinity,
          };
        }
      }
    }

    return results;
  }
  
  /**
   * Parse Google's address_components array into our Address format.
   * Google returns an array of components with types like "street_number",
   * "route", "locality", etc. We need to find the right ones.
   * 
   * @param components - Google's address_components array
   * @returns Our simplified Address object
   */
  private parseAddressComponents(
    components: Array<{ types: readonly string[] | string[]; long_name: string; short_name: string }>
  ): Address {
    // Helper to find a component by its type
    const getComponent = (type: string): string => {
      const component = components.find(c => c.types.includes(type));
      return component?.long_name || '';
    };
    
    // Build street from number + route name
    const streetNumber = getComponent('street_number');
    const route = getComponent('route');
    
    return {
      street: `${streetNumber} ${route}`.trim(),
      city: getComponent('locality') || getComponent('sublocality'),
      state: getComponent('administrative_area_level_1'),
      zipCode: getComponent('postal_code'),
      country: getComponent('country')
    };
  }
}

// =============================================================================
// MOCK GEOCODING SERVICE
// Fake implementation for testing without API calls.
// Returns consistent fake data based on the input.
// =============================================================================

export class MockGeocodingService implements GeocodingService, DistanceService {
  
  /**
   * Return fake coordinates for any address.
   * Uses a hash of the address to generate consistent but varied coordinates.
   */
  async geocodeAddress(address: Address): Promise<GeocodedLocation> {
    // Generate a simple hash from the address for consistent fake coordinates
    const hash = this.simpleHash(address.street + address.zipCode);
    
    // Generate coordinates in the San Francisco Bay Area
    // (roughly 37.3 to 37.9 lat, -122.5 to -121.8 lng)
    const lat = 37.3 + (hash % 600) / 1000;
    const lng = -122.5 + (hash % 700) / 1000;
    
    return {
      address,
      coordinates: { lat, lng },
      formattedAddress: `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`
    };
  }
  
  /**
   * Return a fake address for any coordinates.
   */
  async reverseGeocode(coordinates: Coordinates): Promise<GeocodedLocation> {
    return {
      address: {
        street: '123 Mock Street',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94102'
      },
      coordinates,
      formattedAddress: '123 Mock Street, San Francisco, CA 94102'
    };
  }
  
  /**
   * Calculate distance using Haversine (no API call).
   * Multiplies by 1.4 to estimate road distance, then estimates time.
   */
  async getDistance(origin: Coordinates, destination: Coordinates): Promise<DistanceResult> {
    const crowFliesDistance = haversineDistance(origin, destination);
    
    // Estimate road distance as 1.4x crow-flies distance
    const roadDistance = crowFliesDistance * 1.4;
    
    // Estimate time using our dynamic speed function
    const durationMinutes = this.estimateTime(roadDistance);
    
    return {
      origin,
      destination,
      distanceMiles: roadDistance,
      durationMinutes
    };
  }
  
  /**
   * Build a distance matrix using Haversine calculations.
   */
  async getDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<DistanceResult[][]> {
    const results: DistanceResult[][] = [];
    
    for (let i = 0; i < origins.length; i++) {
      results[i] = [];
      for (let j = 0; j < destinations.length; j++) {
        results[i][j] = await this.getDistance(origins[i], destinations[j]);
      }
    }
    
    return results;
  }
  
  /**
   * Estimate travel time based on distance using dynamic speed.
   * Short trips are slower (city), long trips are faster (highway).
   */
  private estimateTime(distanceMiles: number): number {
    let speedMph: number;
    
    if (distanceMiles < 5) {
      speedMph = 20;  // City driving
    } else if (distanceMiles < 15) {
      speedMph = 35;  // Suburban
    } else {
      speedMph = 55;  // Highway
    }
    
    return (distanceMiles / speedMph) * 60;
  }
  
  /**
   * Simple hash function to generate consistent fake data.
   * Same input always produces same output.
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
