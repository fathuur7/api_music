// File: utils/helpers.js - Helper functions for the API

// Validate search results
function isValidSearchResult(item) {
    return (
      item &&
      typeof item === 'object' &&
      item.type && // ensure it has a type
      item.title && // ensure it has a title
      item.url && // ensure it has a URL
      (item.type === 'video') // ensure it's a valid type
    );
  }
  
  // Filter search result based on configuration
  function filterSearchResult(item, config) {
    if (!item || typeof item !== 'object') return false;
    if (!item.type || (item.type !== 'video' && item.type !== 'shortVideo')) return false;
    if (config.filterLive && item.isLive) return false;
    
    const duration = item.duration ? parseDuration(item.duration) : 0;
    return duration >= config.minDuration && duration <= config.maxDuration;
  }
  
  // Format a single result item
  function formatResult(item, index, includeMetadata) {
    try {
      const safeTitle = escapeMarkdown(item.title);
      const safeAuthor = escapeMarkdown(item.author?.name || 'Unknown');
      
      const baseInfo = {
        id: index + 1,
        title: safeTitle,
        url: item.url,
        thumbnail: item.thumbnails?.[0]?.url || null,
        duration: item.duration || 'N/A',
        author: safeAuthor,
        authorUrl: item.author?.url || null
      };
  
      if (includeMetadata) {
        return {
          ...baseInfo,
          views: formatViews(item.views),
          uploadedAt: item.uploadedAt,
          description: item.description ? 
            escapeMarkdown(item.description.slice(0, 100)) + '...' : '',
          durationInSeconds: parseDuration(item.duration)
        };
      }
  
      return baseInfo;
    } catch (e) {
      console.warn('Item mapping error:', e);
      return null;
    }
  }
  
  // Escape markdown characters
  function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
  
  // Format view counts
  function formatViews(views) {
    if (!views) return '';
    if (views >= 1000000) {
      return `${(views / 1000000).toFixed(1)}M`;
    } else if (views >= 1000) {
      return `${(views / 1000).toFixed(1)}K`;
    }
    return views.toString();
  }
  
  // Parse duration string to seconds
  function parseDuration(duration) {
    if (!duration || typeof duration !== 'string') return 0;
    const parts = duration.split(':');
    if (parts.length === 2) {
      return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
    }
    return 0;
  }

// Export helper functions
export {
    isValidSearchResult,
    filterSearchResult,
    formatResult,
    escapeMarkdown,
    formatViews,
    parseDuration
  };
