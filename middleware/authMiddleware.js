import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export const authenticateUser = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // Pastikan header Authorization ada dan formatnya "Bearer token"
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: Token tidak ditemukan" });
  }

  // Ambil token
  const token = authHeader.split(" ")[1];

  try {
    // Verifikasi token menggunakan secret key dari environment
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Simpan data user hasil decode ke dalam req.user
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized: Token tidak valid" });
  }
};
