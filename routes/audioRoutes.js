// routes/audioRoutes.js
import express from 'express';
import {
  convertVideoToAudio
} from '../controller/audioControllers.js';

const router = express.Router();

// Convert YouTube video to audio and upload to Cloudinary
router.post('/convert', convertVideoToAudio);

export default router;