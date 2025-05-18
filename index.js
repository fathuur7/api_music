import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import searchRoutes from "./routes/searchRoutes.js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import compression from "compression";
// import { initializeYouTubeAPI } from "./controller/audioControllers.js";

// Load environment variables
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// initializeYouTubeAPI(); // Initialize YouTube API token

// Security headers
app.use(helmet());

// Compress responses
app.use(compression());

// Rate limiting - especially important for YouTube API which has quotas
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Apply rate limiter to API routes
app.use('/api', apiLimiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS setup with more secure configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.ALLOWED_ORIGINS?.split(',') || ['*'] 
    : ['*'],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

// ========== Routes ========== //
app.use('/api', searchRoutes);

// Health check endpoint
app.use('/health', (req, res) => {
  res.status(200).send('OK');
});

// Base route
app.use('/', (req, res) => {
  res.status(200).send('Server is running');
});

// Make client path available for routes
app.use((req, res, next) => {
  res.locals.clientPath = __dirname;
  if (process.env.NODE_ENV !== 'production') {
    console.log('Client path:', res.locals.clientPath);
  }
  next();
});

// ========== Error Handler ========== //
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  
  // Don't expose stack traces in production
  const error = process.env.NODE_ENV === 'production' 
    ? { message: "Internal Server Error" }
    : { message: err.message, stack: err.stack };
  
  res.status(err.statusCode || 500).json(error);
});

// ========== Database Connection ========== //
// MongoDB connection options with up-to-date options
const mongoOptions = {
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 30000,
};

// ========== Start Server ========== //
const PORT = process.env.PORT || 3000;

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI, mongoOptions)
  .then(() => {
    console.log('✅ MongoDB connected');
    // Create MongoDB indexes for YouTube search results
    setupYouTubeSearchIndexes();
    
    // Start the server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Function to set up MongoDB indexes for YouTube search
async function setupYouTubeSearchIndexes() {
  try {
    // Assuming you have SearchResult model with relevant collections
    const db = mongoose.connection;
    
    // Index for search queries (to track popular searches)
    await db.collection('searchqueries').createIndex({ query: 1 });
    await db.collection('searchqueries').createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 days TTL
    
    // Index for cached YouTube search results
    await db.collection('searchresults').createIndex({ searchQuery: 1 });
    await db.collection('searchresults').createIndex({ videoId: 1 }, { unique: true });
    await db.collection('searchresults').createIndex({ createdAt: 1 });
    
    // Text index for search within cached results
    await db.collection('searchresults').createIndex({ 
      title: "text", 
      description: "text", 
      channelTitle: "text" 
    }, { 
      weights: {
        title: 10,
        channelTitle: 5,
        description: 3
      },
      name: "YouTubeSearchTextIndex"
    });
    
    console.log('✅ YouTube search indexes created');
  } catch (error) {
    console.error('❌ Error creating YouTube search indexes:', error);
  }
}

function gracefulShutdown(server) {
  console.log('🛑 Shutting down gracefully...');
  
  server.close(() => {
    console.log('🔒 HTTP server closed');
    
    mongoose.connection.close(false, () => {
      console.log('🔒 MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}