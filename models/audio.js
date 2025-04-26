// models/audio.js
import mongoose from 'mongoose';

const AudioSchema = new mongoose.Schema({
  title: { type: String, required: true },
  originalUrl: { type: String, required: true },
  audioUrl: { type: String, required: true },
  publicId: { type: String, required: true }, // Add this for Cloudinary
  thumbnail: { type: String },
  duration: { type: String },
  durationInSeconds: { type: Number },
  artist: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Audio', AudioSchema);