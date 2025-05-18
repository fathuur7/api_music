// controllers/searchController.js
import { searchVideos } from "../services/youtube.js";

/**
 * Handle YouTube search requests
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function search(req, res) {
    const query = req.query.q;
    
    // Extract and validate configuration options from query parameters
    const options = {
        limit: Math.min(50, Math.max(1, parseInt(req.query.limit) || 20)),
        minDuration: Math.max(0, parseInt(req.query.minDuration) || 0),
        maxDuration: Math.min(43200, Math.max(1, parseInt(req.query.maxDuration) || 600)), // Max 12 hours
        filterLive: req.query.filterLive !== 'false',
        includeMetadata: req.query.includeMetadata !== 'false',
        pageToken: req.query.pageToken || null
    };
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing search query. Use ?q=YOUR_SEARCH_QUERY' 
        });
    }
    
    try {
        const results = await searchVideos(query, options);
        res.json({
            success: true,
            data: results,
            metadata: {
                query,
                options: {
                    ...options,
                    // Don't include pageToken in response metadata
                    pageToken: undefined
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Search error:', error);
        
        // Provide more specific error status codes
        const statusCode = error.code === 'QUOTAEXCEEDED' ? 429 : 
                          error.code === 'INVALIDREQUEST' ? 400 : 500;
        
        res.status(statusCode).json({ 
            success: false, 
            error: error.message || 'An error occurred during search',
            errorCode: error.code || 'UNKNOWN' 
        });
    }
}