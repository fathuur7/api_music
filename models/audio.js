import mongoose from 'mongoose';
// Definisi Schema untuk audio
const AudioSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  artist: {
    type: String,
    default: 'Unknown'
  },
  originalUrl: {
    type: String,
    required: true
  },
  audioUrl: {
    type: String,
    required: true
  },
  thumbnail: {
    type: String
  },
  duration: {
    type: String
  },
  durationInSeconds: {
    type: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Audio = mongoose.model('Audio', AudioSchema);

export default Audio;