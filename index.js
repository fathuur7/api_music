import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import userRoutes from "./routes/userRoutes.js";
import audioRoutes from "./routes/audioRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mongoose from "mongoose";

// Load .env
dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Static files
const uploadsDir = join(__dirname, 'uploads');
const controllerUploadsDir = join(__dirname, 'controller/uploads');
app.use('/uploads', express.static(uploadsDir));
app.use('controller/uploads', express.static(controllerUploadsDir));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const corsOptions = {
  origin: ["http://localhost:8081"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};
app.use(cors(corsOptions));

// Routes
app.use("/api/users", userRoutes);
app.use("/api", searchRoutes);
app.use("/api/audio", audioRoutes); // <- pastikan audioRoutes aktif kalau kamu pakai


// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Internal Server Error", error: err.message });
});

app.use('/health', (req, res) => {
  res.status(200).send('OK');
})

app.use('/', (req, res) => {
  res.status(200).send('hello world');
})

// make to know for client path
app.use((req, res, next) => {
  res.locals.clientPath = __dirname;
  console.log('Client path:', res.locals.clientPath);
  next();
});




// Koneksi MongoDB dan jalankan server
const PORT = process.env.PORT || '0.0.0.0';

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));
