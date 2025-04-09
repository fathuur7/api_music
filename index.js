import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { ClerkExpressWithAuth } from "@clerk/clerk-sdk-node";

import userRoutes from "./routes/userRoutes.js";
import audioRoutes from "./routes/audioRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import { DiffieHellman } from "crypto";

// Load .env
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========== Middleware ========== //

// Static file serving
app.use('/uploads', express.static(join(__dirname, 'uploads')));
app.use('/controller/uploads', express.static(join(__dirname, 'controller/uploads')));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

console.log('Clerk Middleware initialized', {
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  webhookSecret: process.env.CLERK_WEBHOOK_SECRET
});

// CORS setup
app.use(cors({
  origin: ["http://localhost:8081"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

// ========== Clerk Auth Middleware ========== //
const publicPaths = ['/webhooks/clerk'];

app.use((req, res, next) => {
  if (publicPaths.some(path => req.path.includes(path))) {
    return next(); // Skip Clerk middleware for webhooks
  }
  return ClerkExpressWithAuth({
    secretKey: process.env.CLERK_SECRET_KEY,
  })(req, res, next);
});

// ========== Routes ========== //
app.use('/clerk', webhookRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api', searchRoutes);

// routes / hello world
app.use('/', (req, res) => {
  res.status(200).json({ message: "Hello World" });
  console.log('Hello World');
})

// ========== Error Handler ========== //
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});

// ========== Start Server ========== //
const PORT = process.env.PORT 

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));
