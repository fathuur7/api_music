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

router.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});
// Endpoint untuk mengkonversi video YouTube menjadi audio
router.post('/convert', convertVideoToAudio);

// Endpoint untuk mendapatkan semua audio yang tersimpan
router.get('/audios', GetAllAudios);

// Endpoint untuk mendapatkan audio berdasarkan ID
router.get('/audios/:id',  GetAudioById);


router.get('/download/:id', DownloadAudioById);
router.get('/download/:id/options', DownloadAudioWithOptions);
router.get('/download/:id/progress', TrackDownloadProgress);



export default router;

