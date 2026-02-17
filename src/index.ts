import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import matchRoutes from './routes/matchRoutes';
import { loadEnvironmentConfig } from './config/config';

// Load environment variables
dotenv.config();

const app = express();
const envConfig = loadEnvironmentConfig();

// =============================================================================
// MIDDLEWARE
// =============================================================================

// CORS configuration
app.use(cors({
  origin: envConfig.allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for simulation testboard
app.use(express.static(path.join(__dirname, '../public')));

// Request logging (development)
if (envConfig.nodeEnv === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// =============================================================================
// ROUTES
// =============================================================================

// API routes
app.use('/api', matchRoutes);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.path} not found`
    }
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: envConfig.nodeEnv === 'development' ? err.message : 'Internal server error'
    }
  });
});

// =============================================================================
// START SERVER
// =============================================================================

const PORT = envConfig.port;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    RIDE MATCHER SERVICE                       ║
╠═══════════════════════════════════════════════════════════════╣
║  Status:      Running                                         ║
║  Port:        ${PORT.toString().padEnd(47)}║
║  Environment: ${envConfig.nodeEnv.padEnd(47)}║
║  API Base:    http://localhost:${PORT}/api${' '.repeat(27)}║
╚═══════════════════════════════════════════════════════════════╝
  `);
  
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('⚠️  WARNING: GOOGLE_MAPS_API_KEY not set. Using mock geocoding service.');
  }
});

export default app;
