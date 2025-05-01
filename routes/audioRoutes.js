// routes/audioRoutes.js
import express from 'express';
import {
  convertVideoToAudio,
  youtubeApiHealthCheck,
  downloadWithProgress
} from '../controller/audioControllers.js';

const router = express.Router();

// Convert YouTube video to audio and upload to Cloudinary
router.post('/convert', convertVideoToAudio);

// Download YouTube audio with progress tracking (supports SSE)
router.post('/download-with-progress', downloadWithProgress);

// Check if YouTube API is working correctly
router.get('/youtube-api-health', youtubeApiHealthCheck);

export default router;