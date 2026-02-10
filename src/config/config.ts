/// <reference types="node" />
import { MatchingConfig, MatcherType } from '../models/types';

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

export const DEFAULT_CONFIG: MatchingConfig = {
  id: 'default',
  name: 'Default Configuration',
  
  // Admin-configurable priority order
  priorityOrder: [
    MatcherType.TIMING,             // 1. Timing constraints (HARD - inbound/outbound)
    MatcherType.EARLY_DEPARTURE,    // 2. Early leavers (HARD for outbound)
    MatcherType.CAPACITY,           // 3. Vehicle capacity (HARD)
    MatcherType.ROUTE_EFFICIENCY,   // 4. Is passenger "on the way"?
    MatcherType.DRIVER_PREFERENCE,  // 5. Passenger's driver preference (future)
    MatcherType.DETOUR_TIME,        // 6. Minimize detour time
    MatcherType.GENDER,             // 7. Gender matching preference
    MatcherType.AGE                 // 8. Age group similarity
  ],
  
  // Thresholds
  maxDetourMiles: 20,
  maxDetourMinutes: 30,
  
  // Cost optimization - Haversine pre-filter threshold
  haversinePreFilterMiles: 35,
  
  // Feature toggles
  enforceGenderPreference: false,
  groupByAgeRange: 15,
  
  // Timing configuration for travel time calculations
  timing: {
    trafficBufferMultiplier: 1.3,   // 30% buffer for traffic
    loadTimeMinutes: 3,             // 3 minutes per passenger pickup/dropoff
    averageSpeedMph: 30             // Assume 30 mph average in suburban areas
  },
  
  // Scoring weights
  weights: {
    earlyDeparture: 0.00,           // Binary - handled as hard constraint
    routeEfficiency: 0.40,
    detour: 0.25,
    genderMatch: 0.15,
    ageMatch: 0.05,
    driverPreference: 0.15
  },
  
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

// =============================================================================
// CONFIGURATION MANAGER
// =============================================================================

export class ConfigManager {
  private configs: Map<string, MatchingConfig> = new Map();
  private defaultConfigId: string = 'default';
  
  constructor() {
    // Initialize with default config
    this.configs.set('default', DEFAULT_CONFIG);
  }
  
  /**
   * Get a configuration by ID, or return default if not found
   */
  getConfig(configId?: string): MatchingConfig {
    if (!configId) {
      return this.getDefaultConfig();
    }
    return this.configs.get(configId) || this.getDefaultConfig();
  }
  
  /**
   * Get the default configuration
   */
  getDefaultConfig(): MatchingConfig {
    return this.configs.get(this.defaultConfigId) || DEFAULT_CONFIG;
  }
  
  /**
   * Create or update a configuration
   */
  saveConfig(config: MatchingConfig): MatchingConfig {
    const now = new Date();
    const existingConfig = this.configs.get(config.id);
    
    const updatedConfig: MatchingConfig = {
      ...config,
      createdAt: existingConfig?.createdAt || now,
      updatedAt: now
    };
    
    // Validate weights sum to 1
    const weightSum = Object.values(updatedConfig.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1) > 0.01) {
      throw new Error(`Config weights must sum to 1, got ${weightSum}`);
    }
    
    // If this is being set as default, unset others
    if (updatedConfig.isDefault) {
      this.configs.forEach((c, id) => {
        if (id !== config.id && c.isDefault) {
          this.configs.set(id, { ...c, isDefault: false });
        }
      });
      this.defaultConfigId = config.id;
    }
    
    this.configs.set(config.id, updatedConfig);
    return updatedConfig;
  }
  
  /**
   * Delete a configuration (cannot delete the last remaining or default)
   */
  deleteConfig(configId: string): boolean {
    if (this.configs.size <= 1) {
      throw new Error('Cannot delete the only configuration');
    }
    if (configId === this.defaultConfigId) {
      throw new Error('Cannot delete the default configuration. Set another as default first.');
    }
    return this.configs.delete(configId);
  }
  
  /**
   * List all configurations
   */
  listConfigs(): MatchingConfig[] {
    return Array.from(this.configs.values());
  }
  
  /**
   * Apply one-time overrides to a config (doesn't persist)
   */
  applyOverrides(
    baseConfig: MatchingConfig,
    overrides: Partial<MatchingConfig>
  ): MatchingConfig {
    return {
      ...baseConfig,
      ...overrides,
      // Deep merge for nested objects
      weights: {
        ...baseConfig.weights,
        ...(overrides.weights || {})
      },
      priorityOrder: overrides.priorityOrder || baseConfig.priorityOrder
    };
  }
  
  /**
   * Update the priority order (admin function)
   */
  updatePriorityOrder(configId: string, newOrder: MatcherType[]): MatchingConfig {
    const config = this.getConfig(configId);
    
    // Validate all matcher types are present
    const allTypes = new Set(Object.values(MatcherType));
    const providedTypes = new Set(newOrder);
    
    if (providedTypes.size !== allTypes.size) {
      throw new Error('Priority order must include all matcher types exactly once');
    }
    
    for (const type of allTypes) {
      if (!providedTypes.has(type)) {
        throw new Error(`Missing matcher type: ${type}`);
      }
    }
    
    return this.saveConfig({
      ...config,
      priorityOrder: newOrder
    });
  }
  
  /**
   * Update a specific threshold
   */
  updateThreshold(
    configId: string,
    threshold: 'maxDetourMiles' | 'maxDetourMinutes' | 'groupByAgeRange',
    value: number
  ): MatchingConfig {
    const config = this.getConfig(configId);
    
    if (value < 0) {
      throw new Error('Threshold values must be non-negative');
    }
    
    return this.saveConfig({
      ...config,
      [threshold]: value
    });
  }
}

// Singleton instance
export const configManager = new ConfigManager();

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

export interface EnvironmentConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  googleMapsApiKey: string;
  firebase: {
    projectId: string;
    privateKey: string;
    clientEmail: string;
  };
  allowedOrigins: string[];
  features: {
    historicalLearning: boolean;
    driverPreferenceRanking: boolean;
  };
}

export function loadEnvironmentConfig(): EnvironmentConfig {
  return {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: (process.env.NODE_ENV as EnvironmentConfig['nodeEnv']) || 'development',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || ''
    },
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
    features: {
      historicalLearning: process.env.ENABLE_HISTORICAL_LEARNING === 'true',
      driverPreferenceRanking: process.env.ENABLE_DRIVER_PREFERENCE_RANKING === 'true'
    }
  };
}
