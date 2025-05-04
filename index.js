import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import audioRoutes from "./routes/audioRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
// import { initializeYouTubeAPI } from "./controller/audioControllers.js";

// Load .env
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// initializeYouTubeAPI(); // Initialize YouTube API token

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// CORS setup
app.use(cors({
  origin: ['*'],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));



// ========== Routes ========== //
app.use('/api/audio', audioRoutes);
app.use('/api', searchRoutes);


// ========== Error Handler ========== //
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.stack);
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});


app.use('/health', (req, res) => {
  res.status(200).send('OK');
})

app.use('/' , (req, res) => {
  res.status(200).send('Server is running');
})


// make to know for client path
app.use((req, res, next) => {
  res.locals.clientPath = __dirname;
  console.log('Client path:', res.locals.clientPath);
  next();
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
