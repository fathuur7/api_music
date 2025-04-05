import { searchVideos } from "../services/youtube.js";

export async function search(req, res) {
    const query = req.query.q;
    // Extract configuration options from query parameters
    const options = {
        limit: parseInt(req.query.limit) || 20,
        minDuration: parseInt(req.query.minDuration) || 0,
        maxDuration: parseInt(req.query.maxDuration) || 600,
        filterLive: req.query.filterLive !== 'false',
        includeMetadata: req.query.includeMetadata !== 'false'
    };
    
    if (!query) {
        return res.status(400).json({ 
        success: false, 
        error: 'Missing search query. Use ?q=YOUR_SEARCH_QUERY' 
        });
    }
    
    try {
        const results = await searchVideos(query, options);
        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
        success: false, 
        error: error.message || 'An error occurred during search' 
        });
    }
}
