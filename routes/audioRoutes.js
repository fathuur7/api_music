import express from 'express';
import {
    convertYtToCloudinary,
    // GetAllAudios,
    // GetAudioById,
    // DownloadAudioById,
    // DownloadAudioWithOptions,
    // fixStuckProcessingRecord,
    // TrackDownloadProgress,
    // getProcessStatusSSE,
    // checkConversionStatus
} from '../controller/audioControllers.js';

const router = express.Router();

// Convert video to audio
router.post('/convertAndUpload', convertYtToCloudinary);


// Get all audio records
// router.get('/', GetAllAudios);

// // Get audio by ID
// router.get('/:id', GetAudioById);

// // Check conversion status
// router.get('/status/:id', checkConversionStatus);

// // Stream process status updates via SSE
// router.get('/process-status/:id', getProcessStatusSSE);

// // Download audio by ID
// router.get('/download/:id', DownloadAudioById);

// // Download audio with specified format and quality options
// router.get('/download/:id/options', DownloadAudioWithOptions);

// // Track download progress
// router.get('/track/:id', TrackDownloadProgress);

// // Fix stuck processing records (admin function)
// router.post('/fix-stuck-record', fixStuckProcessingRecord);

export default router;