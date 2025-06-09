// context-client/index.js
const axios = require('axios');
const EventSource = require('eventsource');

class ContextClient {
  /**
   * Client for interacting with the Tailscale-powered Model Context Server
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - Base URL of the context server
   * @param {string} options.apiKey - API key for authentication (if required)
   * @param {boolean} options.enableCache - Whether to enable local caching
   * @param {number} options.cacheMaxSize - Maximum number of contexts to cache locally
   * @param {number} options.requestTimeout - Request timeout in milliseconds
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://context-server.tailnet.ts.net:3000';
    this.apiKey = options.apiKey;
    this.enableCache = options.enableCache !== false;
    this.cacheMaxSize = options.cacheMaxSize || 100;
    this.requestTimeout = options.requestTimeout || 30000;
    
    // Local cache for contexts
    this.cache = new Map();
    this.eventSources = new Map();
    
    // Configure axios instance
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.requestTimeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
      }
    });
  }
  
  /**
   * Get a context by ID
   * @param {string} contextId - ID of the context to retrieve
   * @param {Object} options - Additional options
   * @param {boolean} options.forceRefresh - Force a refresh from the server
   * @returns {Promise<Object>} - The context data
   */
  async getContext(contextId, options = {}) {
    const { forceRefresh = false } = options;
    
    // Check cache first if not forcing refresh
    if (this.enableCache && !forceRefresh && this.cache.has(contextId)) {
      return this.cache.get(contextId);
    }
    
    try {
      const response = await this.http.get(`/contexts/${contextId}`);
      const context = response.data;
      
      // Update cache
      if (this.enableCache) {
        this.updateCache(contextId, context);
      }
      
      return context;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error(`Context '${contextId}' not found`);
      }
      throw new Error(`Failed to get context: ${error.message}`);
    }
  }
  
  /**
   * Get metadata for a context
   * @param {string} contextId - ID of the context
   * @returns {Promise<Object>} - The context metadata
   */
  async getContextMetadata(contextId) {
    try {
      const response = await this.http.get(`/contexts/${contextId}/metadata`);
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        throw new Error(`Context metadata for '${contextId}' not found`);
      }
      throw new Error(`Failed to get context metadata: ${error.message}`);
    }
  }
  
  /**
   * Create or update a context
   * @param {string} contextId - ID of the context
   * @param {Object} context - The context data
   * @param {Object} metadata - Optional metadata about the context
   * @returns {Promise<Object>} - The result of the operation
   */
  async saveContext(contextId, context, metadata = {}) {
    try {
      const response = await this.http.put(`/contexts/${contextId}`, {
        context,
        metadata
      });
      
      // Update cache
      if (this.enableCache) {
        this.updateCache(contextId, context);
      }
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to save context: ${error.message}`);
    }
  }
  
  /**
   * Delete a context
   * @param {string} contextId - ID of the context to delete
   * @returns {Promise<boolean>} - Whether the deletion was successful
   */
  async deleteContext(contextId) {
    try {
      await this.http.delete(`/contexts/${contextId}`);
      
      // Remove from cache
      if (this.enableCache) {
        this.cache.delete(contextId);
      }
      
      return true;
    } catch (error) {
      throw new Error(`Failed to delete context: ${error.message}`);
    }
  }
  
  /**
   * List available contexts
   * @param {Object} options - Options for listing contexts
   * @param {boolean} options.includeMetadata - Whether to include metadata
   * @returns {Promise<Array>} - Array of context IDs or objects with metadata
   */
  async listContexts(options = {}) {
    const { includeMetadata = false } = options;
    
    try {
      const response = await this.http.get('/contexts', {
        params: { includeMetadata: includeMetadata }
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to list contexts: ${error.message}`);
    }
  }
  
  /**
   * Subscribe to real-time updates for a context
   * @param {string} contextId - ID of the context to subscribe to
   * @param {Function} callback - Callback function for updates
   * @returns {Object} - Subscription object with unsubscribe method
   */
  subscribeToContextUpdates(contextId, callback) {
    // Close existing subscription if any
    this.unsubscribeFromContextUpdates(contextId);
    
    // Create new EventSource connection
    const eventSource = new EventSource(`${this.baseUrl}/contexts/${contextId}/stream`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'update') {
          // Refresh the cache
          this.getContext(contextId, { forceRefresh: true })
            .then(context => {
              callback(null, context, data.metadata);
            })
            .catch(err => {
              callback(err);
            });
        }
      } catch (error) {
        console.error('Error parsing SSE message:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      callback(new Error('SSE connection error'));
    };
    
    // Store the EventSource instance
    this.eventSources.set(contextId, eventSource);
    
    // Return subscription object
    return {
      contextId,
      unsubscribe: () => this.unsubscribeFromContextUpdates(contextId)
    };
  }
  
  /**
   * Unsubscribe from context updates
   * @param {string} contextId - ID of the context to unsubscribe from
   */
  unsubscribeFromContextUpdates(contextId) {
    if (this.eventSources.has(contextId)) {
      const eventSource = this.eventSources.get(contextId);
      eventSource.close();
      this.eventSources.delete(contextId);
    }
  }
  
  /**
   * Update the local cache
   * @private
   * @param {string} contextId - ID of the context
   * @param {Object} context - Context data to cache
   */
  updateCache(contextId, context) {
    // Implement LRU cache behavior
    if (this.cache.size >= this.cacheMaxSize) {
      // Delete oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    // Add to cache
    this.cache.set(contextId, context);
  }
  
  /**
   * Clear the entire cache
   */
  clearCache() {
    this.cache.clear();
  }
  
  /**
   * Close all active connections
   */
  close() {
    // Close all event source connections
    for (const eventSource of this.eventSources.values()) {
      eventSource.close();
    }
    this.eventSources.clear();
  }
}

module.exports = ContextClient;
