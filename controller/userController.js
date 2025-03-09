import db from '../models/index.js';
import axios from "axios";
import User from "../models/userModel.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";


dotenv.config();

export const googleAuth = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Token Google tidak ditemukan" });
  }

  try {
    // Verifikasi token Google dengan Google API
    const googleResponse = await axios.get(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`
    );

    if (!googleResponse.data) {
      return res.status(401).json({ error: "Token Google tidak valid" });
    }

    // Ambil data dari token
    const { sub: googleId, email, name, picture: image } = googleResponse.data;

    // Cek apakah user sudah ada di database
    let user = await User.findOne({ where: { googleId } });

    // Jika belum, lakukan register user baru
    if (!user) {
      user = await User.create({ googleId, email, name, image });
    }

    // Buat JWT untuk user
    const jwtToken = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Kembalikan response dengan token dan data user
    return res.status(200).json({ token: jwtToken, user });
  } catch (error) {
    console.error("Error during Google authentication:", error);
    return res.status(500).json({ error: error.message });
  }
};
