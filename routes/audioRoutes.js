import express from 'express';
import {
    convertVideoToAudio,
    GetAllAudios,
    GetAudioById,
    DownloadAudioById, 
    DownloadAudioWithOptions, 
    TrackDownloadProgress
} from '../controller/audioControllers.js';

const router = express.Router();


// Rute untuk mengkonversi video ke audio
router.post('/convert', convertVideoToAudio);

// Rute untuk mendapatkan semua audio
router.get('/', GetAllAudios);

// Rute untuk mendapatkan satu audio berdasarkan ID
router.get('/:id', GetAudioById);

// Rute untuk mendownload audio berdasarkan ID
router.get('/download/:id', DownloadAudioById);

https://api-music-six.vercel.app/api/audio/status/680fc0a016590e90f4aa5fd4
// status/:id
// Rute untuk mendapatkan status download audio berdasarkan ID
router.get('/status/:id', GetAudioById);

// Rute untuk mendownload audio dengan opsi format dan kualitas
router.get('/download/:id/options', DownloadAudioWithOptions);

// Rute untuk tracking progress download
router.get('/track/:id', TrackDownloadProgress);



export default router;

