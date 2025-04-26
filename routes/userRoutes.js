import express from 'express';
import { requireAuth,getUserFromDB  } from '../middleware/auth.js';
import User from '../models/user.js'; // Import model User

const router = express.Router();
// Mendapatkan user yang sedang login
router.get('/me', requireAuth, getUserFromDB, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ message: 'User tidak ditemukan di database' });
    }
    
    res.json(req.user);
  } catch (error) {
    console.error('Error mendapatkan user:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update metadata user
router.patch('/metadata', requireAuth, getUserFromDB, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ message: 'User tidak ditemukan di database' });
    }
    
    // Update metadata
    req.user.metadata = { ...req.user.metadata, ...req.body };
    req.user.updatedAt = new Date();
    
    await req.user.save();
    
    res.json(req.user);
  } catch (error) {
    console.error('Error update metadata:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;