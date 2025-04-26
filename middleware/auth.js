import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import User from '../models/user.js'; // Import model User


// Middleware untuk memverifikasi autentikasi Clerk
export const requireAuth = ClerkExpressRequireAuth();

// Middleware untuk mendapatkan user dari database setelah autentikasi Clerk
export const getUserFromDB = async (req, res, next) => {
  try {
    // Pastikan request sudah diautentikasi oleh Clerk
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({ message: 'Tidak terautentikasi' });
    }

    // Cari user berdasarkan clerkId
    const user = await User.findOne({ clerkId: req.auth.userId });
    
    // Jika user ada, tambahkan ke request
    if (user) {
      req.user = user;
    }

    next();
  } catch (error) {
    console.error('Error mengambil user dari database:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

