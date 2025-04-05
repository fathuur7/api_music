import { DataTypes } from 'sequelize';
import { sequelize } from '../models/index.js'; // Pastikan impor dilakukan sesuai ekspor di index.js

const Lagu = sequelize.define('lagu', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    judul: {
        type: DataTypes.STRING,
        allowNull: false
    },
    penyanyi: {
        type: DataTypes.STRING,
        allowNull: false
    },
    album: {
        type: DataTypes.STRING,
        allowNull: false
    },
    genre: {
        type: DataTypes.STRING,
        allowNull: false
    },
    durasi: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tanggal_rilis: {
        type: DataTypes.DATE,
        allowNull: false
    },
    cover :{
        type: DataTypes.STRING,
        allowNull: false
    },
    url_path :{
        type: DataTypes.STRING,
        allowNull: false
    }
});

export default Lagu;
