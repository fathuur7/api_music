import express from 'express';
import { googleAuth } from '../controller/userController.js';
import { authenticateUser } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/google-auth', authenticateUser, googleAuth);
export default router;
