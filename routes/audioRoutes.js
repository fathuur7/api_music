import express from 'express';
import {
    convertVideoToAudio,
    GetAllAudios,
    GetAudioById,
    DownloadAudioById, 
    DownloadAudioWithOptions, 
    fixStuckProcessingRecord,
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

router.post('/fix-stuck-record', fixStuckProcessingRecord);
router.get('/status/:id', GetAudioById);

// Rute untuk mendownload audio dengan opsi format dan kualitas
router.get('/download/:id/options', DownloadAudioWithOptions);

// Rute untuk tracking progress download
router.get('/track/:id', TrackDownloadProgress);



export default router;

