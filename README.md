# Ride Matcher Service

Intelligent ride matching microservice for community carpooling, designed to work with [grace-link-jc](https://github.com/your-org/grace-link-jc). Given passengers who need rides and drivers who can give them, this service optimally groups them together for safe, efficient trips to and from community events.

---

## Overview

### The Problem
After a community event (church service, meeting, etc.), organizers need to coordinate rides home for attendees. Manually matching passengers to drivers is time-consuming and often inefficient — drivers end up going far out of their way, or passengers get left without rides.

### The Solution
This service automatically:
- **Groups passengers with drivers** heading in similar directions
- **Optimizes drop-off/pickup order** to minimize total driving time
- **Respects constraints** like vehicle capacity, gender preferences, and timing
- **Handles edge cases** like early departures and identifies unmatched passengers

---

## Key Features

### Core Matching
- **Smart Grouping** — Uses "ellipse model" to find passengers who are "on the way" for each driver
- **Capacity Enforcement** — Never exceeds vehicle seat limits
- **Detour Limits** — Configurable maximum miles a driver can go out of their way (default: 20 miles)
- **Gender Preferences** — Passengers can request same-gender drivers (soft constraint)
- **Age Grouping** — Prefers matching similar age groups when possible

### Bidirectional Support (v2.0)
- **Outbound (FROM_EVENT)** — Drop passengers off on the way home after an event
- **Inbound (TO_EVENT)** — Pick passengers up on the way to an event

### Timing & Scheduling
- **Early Departure (Outbound)** — Groups early-leavers with early-leaving drivers
- **Pickup Scheduling (Inbound)** — Backward calculation ensures on-time arrival
- **Hard Constraints** — Early passengers can't ride with late drivers; pickups can't be before ready times
- **Calculated Pickup Times** - System tells passengers when to be ready (`shouldBeReadyBy`)
- **Schedule Response** - Inbound results include driver departure time and all pickup times

### Optimization
- **Furthest Driver First** — Drivers with longer routes are processed first (larger "catchment area")
- **Nearest Neighbor Routing** — Optimizes stop order within each group
- **Zero API Cost** — Uses Haversine formula with road factor; no Google Maps API calls required

### Reporting
- **Unmatched Tracking** — Lists passengers who couldn't be matched with specific reasons
- **Suggested Actions** — Provides guidance for unmatched passengers (e.g., "arrange rideshare")
- **Admin Overrides** — Manual adjustment of results after matching

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Service runs at `http://localhost:3001`

---

## Simulation Testboard

A browser-based visual testboard for testing and debugging the matching algorithm interactively.

### Usage

1. Start the server:
   ```bash
   npm run dev
   ```

2. Open your browser:
   ```
   http://localhost:3001
   ```

3. Select a preset scenario or configure sliders manually, then click **"시뮬레이션 실행"** (Run Simulation).

### Features

- **Interactive Map** — Leaflet-based map showing pre-match markers and post-match route polylines
- **10 Preset Scenarios** — Sunday worship, Friday youth group, Christmas service, senior ministry, bad weather emergency, and more
- **Participant Controls** — Adjust passenger count (1–50), driver count (1–15), early departure ratio, and gender preference ratio via sliders
- **Algorithm Tuning** — Real-time adjustment of matcher weights, max detour distance, traffic buffer, and gender enforcement
- **Results Panel** — Match rate, ride group details with stop order, detour per passenger, and unmatched passenger reasons

### Testboard Structure

```
public/
├── index.html            # Main UI (sidebar + map layout)
├── css/
│   └── style.css         # Styles
└── js/
    ├── app.js            # App controller (event binding, state management)
    ├── simulation.js     # API integration + result rendering
    ├── data-generator.js # Philadelphia-based test data generator
    ├── presets.js        # 10 church scenario presets
    └── map.js            # Leaflet map visualization
```

> **Note:** Works without a Google Maps API key. The mock geocoding service uses Haversine-based distance calculations.

---

## API Reference

### Match Passengers to Drivers

```
POST /api/match
```

**Request Body:**

```json
{
  "eventId": "sunday-service-2024-01-14",
  "tripDirection": "TO_EVENT",
  "eventLocation": {
    "street": "123 Church Street",
    "city": "San Francisco",
    "state": "CA",
    "zipCode": "94102"
  },
  "eventStartTime": "2024-01-14T09:00:00Z",
  "passengers": [
    {
      "id": "uuid-1",
      "name": "Alice Johnson",
      "gender": "female",
      "age": 28,
      "homeAddress": { ... },
      "needsRide": true,
      "genderPreference": "any",
      "leavingEarly": false
    }
  ],
  "drivers": [
    {
      "id": "uuid-2",
      "name": "Bob Smith",
      "gender": "male",
      "age": 35,
      "homeAddress": { ... },
      "canDrive": true,
      "availableSeats": 3,
      "leavingEarly": false
    }
  ]
}
```

**Key Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `tripDirection` | Yes | `TO_EVENT` (inbound) or `FROM_EVENT` (outbound) |
| `eventStartTime` | For inbound | When event starts (for pickup time calculation) |
| `eventEndTime` | Optional | When event ends (for reference) |
| `leavingEarly` | Optional | If true, must be matched with early-leaving driver (outbound) |

**Note on Inbound Trips:** Passengers do NOT need to specify when they'll be ready. The system calculates and tells them when to be ready (`shouldBeReadyBy` in the response).

---

## How It Works

### Outbound (FROM_EVENT)

```
Event ──→ Passenger A ──→ Passenger B ──→ Driver Home
         (drop off)      (drop off)
```

1. Drivers sorted **furthest first** (larger catchment area)
2. Early-leaving drivers matched first with early-leaving passengers
3. **HARD CONSTRAINT**: Early passengers cannot ride with non-early drivers
4. **PRIORITY**: Everyone gets a ride home, even if it means longer detours
5. Drop-off order optimized using nearest-neighbor

### Inbound (TO_EVENT)

```
Driver Home ──→ Passenger A ──→ Passenger B ──→ Event
                (pick up)       (pick up)
```

1. Backward calculation from `eventStartTime`
2. `Pickup Time = Event Start - Travel Time × 1.3 - Load Time`
3. System tells each passenger: "Be ready by [time]"
3. **HARD CONSTRAINT**: If pickup time < passenger's `readyTime`, match is invalid
4. Driver departure time calculated to ensure on-time arrival

### Route Efficiency (Ellipse Model)

Both directions use the same scoring formula:

```
efficiency = direct_distance / (origin → passenger → destination)
```

- `efficiency = 1.0` → Passenger is perfectly on the way
- `efficiency < 0.5` → Route is 2x longer (poor match)

---

## Response Structure

```json
{
  "success": true,
  "result": {
    "id": "result-uuid",
    "tripDirection": "TO_EVENT",
    "rideGroups": [
      {
        "id": "group-uuid",
        "tripDirection": "TO_EVENT",
        "driver": {
          "name": "Bob Smith",
          "departureTime": "2024-01-14T07:45:00Z",
          "totalRouteDistance": 15.3,
          "totalDetour": 3.2
        },
        "passengers": [
          {
            "name": "Alice Johnson",
            "stopOrder": 1,
            "pickupOrder": 1,
            "shouldBeReadyBy": "2024-01-14T08:05:00Z"
          }
        ],
        "schedule": {
          "driverDepartureTime": "2024-01-14T07:45:00Z",
          "pickupTimes": [
            { "passengerId": "uuid-1", "time": "2024-01-14T08:05:00Z" }
          ],
          "estimatedArrivalTime": "2024-01-14T08:55:00Z"
        }
      }
    ],
    "unmatchedPassengers": [
      {
        "name": "Charlie Brown",
        "reason": "early_departure_mismatch",
        "suggestedAction": "No drivers are leaving early. Please arrange a rideshare."
      }
    ]
  }
}
```

**Key Response Fields:**

| Field | Description |
|-------|-------------|
| `shouldBeReadyBy` | (Inbound) When passenger needs to be ready for pickup |
| `departureTime` | (Inbound) When driver should leave home |
| `dropOffOrder` | (Outbound) Order of drop-off (1 = first) |
| `pickupOrder` | (Inbound) Order of pickup (1 = first) |
| `schedule` | (Inbound) Complete timing schedule for the ride group |

---

## Timing Configuration

```javascript
timing: {
  trafficBufferMultiplier: 1.3,  // 30% buffer for traffic
  loadTimeMinutes: 3,            // 3 min per pickup/dropoff
  averageSpeedMph: 30            // Suburban average
}
```

### Inbound Calculation Example

```
Event Start: 9:00 AM
Total Route: 20 miles
Average Speed: 30 mph
Traffic Buffer: 1.3x
Passengers: 3
Load Time: 3 min each

Travel Time = (20 / 30) × 60 × 1.3 = 52 minutes
Load Time = 3 × 3 = 9 minutes
Buffer = 10 minutes

Driver Departure = 9:00 AM - 52 - 9 - 10 = 7:49 AM
```

---

## Unmatched Reasons

| Reason | Description |
|--------|-------------|
| `early_departure_mismatch` | Passenger leaving early but no early driver |
| `pickup_time_too_early` | Inbound: pickup before passenger's readyTime |
| `exceeds_detour_limit` | Home is too far out of the way |
| `gender_preference_unmet` | No same-gender driver available |
| `no_seats_available` | All vehicles are full |
| `no_available_drivers` | General - no valid match found |

---

## Cost Optimization

**Zero real-time API calls during matching:**

1. All distances use `Haversine × 1.4` (road factor)
2. Travel times use `distance / speed × 1.3` (traffic buffer)
3. No Google Maps Distance Matrix API calls needed
4. Optional: Enable API calls for final route optimization

---

## Data Models

### Passenger

```typescript
interface Passenger {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
  age: number;
  homeAddress: Address;
  needsRide: boolean;
  genderPreference: 'same_gender' | 'any';
  leavingEarly: boolean;           // For outbound
  earlyDepartureTime?: Date;       // Specific early time
  readyTime?: Date;                // For inbound - earliest pickup
}
```

### Driver

```typescript
interface Driver {
  id: string;
  name: string;
  gender: Gender;
  age: number;
  homeAddress: Address;
  canDrive: boolean;
  availableSeats: number;
  leavingEarly: boolean;
  earlyDepartureTime?: Date;
  readyTime?: Date;                // For inbound - earliest departure
}
```

---

## Priority Order

```
1. TIMING          - Hard constraint (early/pickup time)
2. EARLY_DEPARTURE - Groups early leavers (outbound)
3. CAPACITY        - Vehicle seats (hard)
4. ROUTE_EFFICIENCY- Is passenger "on the way"?
5. DRIVER_PREFERENCE- Future: passenger rankings
6. DETOUR_TIME     - Minimize extra driving
7. GENDER          - Soft preference
8. AGE             - Group similar ages
```

---

## Local Development & Testing

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Git

### Step 1: Install & Run Locally

```bash
# Extract the zip and enter directory
cd ride-matcher-service

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server (with hot reload)
npm run dev
```

Server runs at `http://localhost:3001`

### Step 2: Run Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode (re-runs on file changes)
npm test -- --watch
```

### Step 3: Test the API Manually

**Health Check:**
```bash
curl http://localhost:3001/api/health
```

**Test Outbound Matching:**
```bash
curl -X POST http://localhost:3001/api/match \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-event",
    "tripDirection": "FROM_EVENT",
    "eventLocation": {
      "street": "123 Church St",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94102"
    },
    "passengers": [{
      "id": "p1",
      "name": "Alice",
      "gender": "female",
      "age": 25,
      "homeAddress": {"street": "456 Oak Ave", "city": "SF", "state": "CA", "zipCode": "94110"},
      "homeCoordinates": {"lat": 37.75, "lng": -122.42},
      "needsRide": true,
      "genderPreference": "any",
      "leavingEarly": false
    }],
    "drivers": [{
      "id": "d1",
      "name": "Bob",
      "gender": "male",
      "age": 30,
      "homeAddress": {"street": "789 Pine St", "city": "SF", "state": "CA", "zipCode": "94108"},
      "homeCoordinates": {"lat": 37.78, "lng": -122.41},
      "canDrive": true,
      "availableSeats": 3,
      "leavingEarly": false
    }]
  }'
```

**Test Inbound Matching:**
```bash
curl -X POST http://localhost:3001/api/match \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "test-event",
    "tripDirection": "TO_EVENT",
    "eventStartTime": "2024-01-14T09:00:00Z",
    "eventLocation": {
      "street": "123 Church St",
      "city": "San Francisco",
      "state": "CA",
      "zipCode": "94102"
    },
    "passengers": [{
      "id": "p1",
      "name": "Alice",
      "gender": "female",
      "age": 25,
      "homeAddress": {"street": "456 Oak Ave", "city": "SF", "state": "CA", "zipCode": "94110"},
      "homeCoordinates": {"lat": 37.75, "lng": -122.42},
      "needsRide": true,
      "genderPreference": "any",
      "leavingEarly": false,
      "readyTime": "2024-01-14T07:00:00Z"
    }],
    "drivers": [{
      "id": "d1",
      "name": "Bob",
      "gender": "male",
      "age": 30,
      "homeAddress": {"street": "789 Pine St", "city": "SF", "state": "CA", "zipCode": "94108"},
      "homeCoordinates": {"lat": 37.78, "lng": -122.41},
      "canDrive": true,
      "availableSeats": 3,
      "leavingEarly": false
    }]
  }'
```

---

## GitHub Setup

### Step 1: Create New Repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `ride-matcher-service`
3. Description: "Intelligent ride matching microservice for community carpooling"
4. Set to **Private** (recommended) or Public
5. Do NOT initialize with README (we have one)
6. Click "Create repository"

### Step 2: Push Code to GitHub

```bash
cd ride-matcher-service

# Initialize git
git init

# Add all files
git add .

# Initial commit
git commit -m "Initial commit: Ride Matcher Service v2.0"

# Add your GitHub repo as remote (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/ride-matcher-service.git

# Push to main branch
git branch -M main
git push -u origin main
```

### Step 3: Protect Main Branch (Recommended)

1. Go to repo Settings → Branches
2. Add branch protection rule for `main`
3. Enable "Require pull request reviews before merging"

---

## Deployment Options

### Option A: Firebase Cloud Functions (Recommended for grace-link-jc)

Since grace-link-jc already uses Firebase, this is the easiest integration.

**Step 1: Setup Firebase Functions**

```bash
# In ride-matcher-service directory
npm install -g firebase-tools
firebase login
firebase init functions

# Select your grace-link-jc Firebase project
# Choose TypeScript
# Say YES to ESLint
```

**Step 2: Create Cloud Function Wrapper**

Create `functions/src/index.ts`:

```typescript
import * as functions from 'firebase-functions';
import app from '../../src/index'; // Your Express app

export const rideMatcherApi = functions
  .runWith({ 
    timeoutSeconds: 60,
    memory: '512MB'
  })
  .https.onRequest(app);
```

**Step 3: Deploy**

```bash
firebase deploy --only functions
```

Your API will be at: `https://us-central1-YOUR_PROJECT.cloudfunctions.net/rideMatcherApi`

---

### Option B: Railway (Simple & Free Tier)

**Step 1: Connect GitHub**

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `ride-matcher-service`

**Step 2: Configure**

Railway auto-detects Node.js. Add environment variables:
- `PORT`: 3001
- `NODE_ENV`: production

**Step 3: Deploy**

Railway deploys automatically on git push. You get a URL like:
`https://ride-matcher-service-production.up.railway.app`

---

### Option C: Render (Free Tier)

**Step 1: Create Web Service**

1. Go to [render.com](https://render.com)
2. New → Web Service → Connect GitHub repo
3. Settings:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Instance Type: Free

**Step 2: Environment Variables**

Add in Render dashboard:
- `PORT`: 3001
- `NODE_ENV`: production

---

## Integrating with grace-link-jc

### Step 1: Create API Service in grace-link-jc

Create `src/services/rideMatcherService.ts`:

```typescript
// Use environment variable for flexibility
const RIDE_MATCHER_URL = import.meta.env.VITE_RIDE_MATCHER_URL || 'http://localhost:3001';

export interface MatchingRequest {
  eventId: string;
  tripDirection: 'TO_EVENT' | 'FROM_EVENT';
  eventLocation: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
  };
  eventStartTime?: string;
  passengers: Passenger[];
  drivers: Driver[];
}

export async function runMatching(request: MatchingRequest) {
  const response = await fetch(`${RIDE_MATCHER_URL}/api/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Matching failed');
  }
  
  return response.json();
}

export async function getMatchingResult(resultId: string) {
  const response = await fetch(`${RIDE_MATCHER_URL}/api/match/${resultId}`);
  return response.json();
}
```

### Step 2: Add Environment Variable

In grace-link-jc `.env`:

```bash
# Local development
VITE_RIDE_MATCHER_URL=http://localhost:3001

# Production (replace with your deployed URL)
# VITE_RIDE_MATCHER_URL=https://your-deployed-service.com
```

### Step 3: Example Usage in Component

```typescript
import { runMatching } from '@/services/rideMatcherService';

async function handleMatchRides() {
  try {
    const result = await runMatching({
      eventId: event.id,
      tripDirection: 'FROM_EVENT',
      eventLocation: {
        street: event.address,
        city: event.city,
        state: event.state,
        zipCode: event.zipCode
      },
      passengers: attendees.filter(a => a.needsRide),
      drivers: attendees.filter(a => a.canDrive)
    });
    
    if (result.success) {
      setRideGroups(result.result.rideGroups);
      setUnmatched(result.result.unmatchedPassengers);
    }
  } catch (error) {
    console.error('Matching failed:', error);
  }
}
```

### Step 4: CORS Configuration

Update `ride-matcher-service/.env` to allow your grace-link-jc domain:

```bash
ALLOWED_ORIGINS=http://localhost:5173,https://your-grace-link-jc.web.app
```

---

## Project Structure

```
ride-matcher-service/
├── public/                      # Simulation testboard (served as static files)
│   ├── index.html               # Main UI
│   ├── css/style.css            # Styles
│   └── js/
│       ├── app.js               # App controller
│       ├── simulation.js        # API integration + result rendering
│       ├── data-generator.js    # Test data generator
│       ├── presets.js           # Preset scenarios
│       └── map.js               # Leaflet map visualization
├── src/
│   ├── config/
│   │   └── config.ts            # Matching configuration
│   ├── matchers/
│   │   ├── BaseMatcher.ts       # Abstract matcher interface
│   │   ├── MatchingEngine.ts    # Core algorithm
│   │   └── implementations.ts   # All matchers (Timing, Capacity, etc.)
│   ├── models/
│   │   └── types.ts             # TypeScript interfaces
│   ├── routes/
│   │   └── matchRoutes.ts       # Express routes
│   ├── utils/
│   │   └── geocoding.ts         # Geocoding services
│   └── index.ts                 # Entry point
├── tests/
│   └── matching.test.ts         # Test suite
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## License

MIT
