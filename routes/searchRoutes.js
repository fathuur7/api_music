import { search } from '../controller/searchController.js';
import express from 'express';


const router = express.Router();

router.get('/search', search);

export default router;