// models/audio.js
import mongoose from 'mongoose';

const AudioSchema = new mongoose.Schema({
  title: { type: String, required: true },
  originalUrl: { type: String, required: true },
  audioUrl: { type: String, required: true },
  publicId: { type: String, required: true }, // Cloudinary public ID
  thumbnail: { type: String },
  duration: { type: String },
  durationInSeconds: { type: Number },
  artist: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // Added fields for process monitoring and download tracking
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending' 
  },
  downloadCount: { 
    type: Number, 
    default: 0 
  },
  monitoringId: { 
    type: String, 
    default: null 
  },
  errorMessage: { 
    type: String 
  },
  processingLogs: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    message: String,
    status: String,
    progress: Number
  }]
});

// Add an index on monitoringId for faster lookups
AudioSchema.index({ monitoringId: 1 });

// Add an index on originalUrl for checking duplicates
AudioSchema.index({ originalUrl: 1 });

// Middleware to update the updatedAt field on save
AudioSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Audio', AudioSchema);