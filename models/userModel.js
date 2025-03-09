import { DataTypes } from 'sequelize';
import { sequelize } from '../models/index.js'; // Pastikan impor dilakukan sesuai ekspor di index.js

const User = sequelize.define('users', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    googleId: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
        validate: {
            isEmail: true // ✅ Validasi agar email benar
        }
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            len: [3, 50] // ✅ Nama harus 3-50 karakter
        }
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isUrl: true // ✅ Pastikan gambar adalah URL valid
        }
    }
}, {
    timestamps: true, // ✅ Tambahkan createdAt & updatedAt otomatis
    indexes: [
        {
            unique: true,
            fields: ['email'] // ✅ Index untuk pencarian cepat berdasarkan email
        },
        {
            unique: true,
            fields: ['googleId'] // ✅ Index untuk pencarian cepat berdasarkan Google ID
        }
    ]
});

export default User;
