// context-server/index.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const EventEmitter = require('events');
const axios = require('axios');
const axios = require('axios');

// Context event emitter for real-time updates
const contextEvents = new EventEmitter();
// Set a higher limit for event listeners to avoid warnings
contextEvents.setMaxListeners(100);

// Configuration
const config = {
  serverType: process.env.SERVER_TYPE || 'central', // 'central', 'regional', 'cache'
  dataDir: process.env.DATA_DIR || './data',
  port: parseInt(process.env.PORT || '3000'),
  centralAuthority: process.env.CENTRAL_AUTHORITY || 'http://central-authority.tailnet.ts.net:3000',
  syncInterval: parseInt(process.env.SYNC_INTERVAL || '60000'), // 1 minute by default
  cacheTTL: parseInt(process.env.CACHE_TTL || '3600000'), // 1 hour by default
  nodeId: process.env.NODE_ID || uuidv4(),
  regionId: process.env.REGION_ID || 'default',
};

// Ensure data directory exists
const ensureDataDir = async () => {
  try {
    await mkdirAsync(config.dataDir, { recursive: true });
    console.log(`Data directory ${config.dataDir} is ready`);
  } catch (err) {
    console.error(`Failed to create data directory: ${err.message}`);
    process.exit(1);
  }
};

// Initialize Express app
const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(cors());

// In-memory cache for frequently accessed contexts
const contextCache = new Map();
const metadataCache = new Map();

// Context Storage
class ContextStorage {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  async getContextPath(contextId) {
    return path.join(this.baseDir, `${contextId}.json`);
  }

  async getMetadataPath(contextId) {
    return path.join(this.baseDir, `${contextId}.meta.json`);
  }

  async exists(contextId) {
    try {
      await readFileAsync(await this.getContextPath(contextId));
      return true;
    } catch (err) {
      return false;
    }
  }

  async getMetadata(contextId) {
    // Check cache first
    if (metadataCache.has(contextId)) {
      return metadataCache.get(contextId);
    }

    try {
      const data = await readFileAsync(await this.getMetadataPath(contextId), 'utf8');
      const metadata = JSON.parse(data);
      metadataCache.set(contextId, metadata);
      return metadata;
    } catch (err) {
      console.error(`Failed to read metadata for ${contextId}: ${err.message}`);
      return null;
    }
  }

  async getContext(contextId) {
    // Check cache first
    if (contextCache.has(contextId)) {
      return contextCache.get(contextId);
    }

    try {
      const data = await readFileAsync(await this.getContextPath(contextId), 'utf8');
      const context = JSON.parse(data);
      
      // Update cache
      contextCache.set(contextId, context);
      
      return context;
    } catch (err) {
      console.error(`Failed to read context ${contextId}: ${err.message}`);
      return null;
    }
  }

  async saveContext(contextId, context, metadata = {}) {
    const now = new Date().toISOString();
    const contextPath = await this.getContextPath(contextId);
    const metadataPath = await this.getMetadataPath(contextId);
    
    // Update metadata
    const updatedMetadata = {
      ...metadata,
      lastModified: now,
      size: JSON.stringify(context).length,
      version: (metadata.version || 0) + 1,
    };
    
    try {
      // Write context data
      await writeFileAsync(contextPath, JSON.stringify(context));
      
      // Write metadata
      await writeFileAsync(metadataPath, JSON.stringify(updatedMetadata));
      
      // Update caches
      contextCache.set(contextId, context);
      metadataCache.set(contextId, updatedMetadata);
      
      // Emit context update event
      contextEvents.emit('contextUpdated', contextId, updatedMetadata);
      
      return updatedMetadata;
    } catch (err) {
      console.error(`Failed to save context ${contextId}: ${err.message}`);
      throw err;
    }
  }

  async listContexts() {
    try {
      const files = await promisify(fs.readdir)(this.baseDir);
      const contextFiles = files.filter(file => !file.includes('.meta.') && file.endsWith('.json'));
      return contextFiles.map(file => path.basename(file, '.json'));
    } catch (err) {
      console.error(`Failed to list contexts: ${err.message}`);
      return [];
    }
  }

  async deleteContext(contextId) {
    try {
      await promisify(fs.unlink)(await this.getContextPath(contextId));
      await promisify(fs.unlink)(await this.getMetadataPath(contextId));
      
      // Remove from caches
      contextCache.delete(contextId);
      metadataCache.delete(contextId);
      
      // Emit context deletion event
      contextEvents.emit('contextDeleted', contextId);
      
      return true;
    } catch (err) {
      console.error(`Failed to delete context ${contextId}: ${err.message}`);
      return false;
    }
  }
}

// Initialize storage
let storage;

// API Routes
const initializeRoutes = () => {
  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      serverType: config.serverType,
      nodeId: config.nodeId,
      regionId: config.regionId 
    });
  });

  // Get context by ID
  app.get('/contexts/:contextId', async (req, res) => {
    const { contextId } = req.params;
    const context = await storage.getContext(contextId);
    
    if (!context) {
      if (config.serverType === 'cache' || config.serverType === 'regional') {
        // Try to fetch from central if we're a cache or regional server
        try {
          // Implement fetch from central logic
          return res.status(404).json({ error: 'Context not found and central fetch not implemented yet' });
        } catch (err) {
          return res.status(500).json({ error: 'Failed to fetch from central server' });
        }
      }
      return res.status(404).json({ error: 'Context not found' });
    }
    
    res.json(context);
  });

  // Get context metadata
  app.get('/contexts/:contextId/metadata', async (req, res) => {
    const { contextId } = req.params;
    const metadata = await storage.getMetadata(contextId);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Context metadata not found' });
    }
    
    res.json(metadata);
  });

  // Create or update context
  app.put('/contexts/:contextId', async (req, res) => {
    const { contextId } = req.params;
    const { context, metadata = {} } = req.body;
    
    if (!context) {
      return res.status(400).json({ error: 'Context data is required' });
    }
    
    try {
      const updatedMetadata = await storage.saveContext(contextId, context, metadata);
      
      // If we're a central server, propagate to regionals
      if (config.serverType === 'central' && req.app.get('tailscale')) {
        try {
          // Get Tailscale instance from app
          const tailscale = req.app.get('tailscale');
          
          // Propagate to regional servers asynchronously
          propagateToRegionals(tailscale, contextId, context, updatedMetadata)
            .then((results) => {
              console.log(`Propagation results for context ${contextId}:`, results);
            })
            .catch((error) => {
              console.error(`Error during propagation for context ${contextId}:`, error);
            });
        } catch (propagationError) {
          console.error(`Failed to start propagation for context ${contextId}:`, propagationError);
          // Don't fail the request due to propagation issues
        }
      }
      
      res.json({ 
        success: true, 
        contextId,
        metadata: updatedMetadata
      });
    } catch (err) {
      res.status(500).json({ error: `Failed to save context: ${err.message}` });
    }
  });

  // Delete context
  app.delete('/contexts/:contextId', async (req, res) => {
    const { contextId } = req.params;
    const success = await storage.deleteContext(contextId);
    
    if (!success) {
      return res.status(500).json({ error: 'Failed to delete context' });
    }
    
    // If we're a central server, propagate deletion
    if (config.serverType === 'central' && req.app.get('tailscale')) {
      try {
        // Get Tailscale instance from app
        const tailscale = req.app.get('tailscale');
        
        // Propagate deletion to regional servers asynchronously
        propagateDeletionToRegionals(tailscale, contextId)
          .then((results) => {
            console.log(`Deletion propagation results for context ${contextId}:`, results);
          })
          .catch((error) => {
            console.error(`Error during deletion propagation for context ${contextId}:`, error);
          });
      } catch (propagationError) {
        console.error(`Failed to start deletion propagation for context ${contextId}:`, propagationError);
        // Don't fail the request due to propagation issues
      }
    }
    
    res.json({ success: true });
  });

  // List available contexts
  app.get('/contexts', async (req, res) => {
    const contextIds = await storage.listContexts();
    
    // Optionally include metadata
    if (req.query.includeMetadata === 'true') {
      const contextsWithMetadata = await Promise.all(
        contextIds.map(async (id) => {
          const metadata = await storage.getMetadata(id);
          return { id, metadata };
        })
      );
      return res.json(contextsWithMetadata);
    }
    
    res.json(contextIds);
  });

  // Stream updates for a context (for real-time syncing)
  app.get('/contexts/:contextId/stream', (req, res) => {
    const { contextId } = req.params;
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if used
    
    // Send an initial connection message
    res.write(`data: ${JSON.stringify({ event: 'connected', contextId, timestamp: new Date().toISOString() })}\n\n`);
    
    // Keep connection alive by sending a ping every 30 seconds
    const pingInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ event: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);
    
    // Create event handler for context updates
    const updateHandler = (updatedContextId, metadata) => {
      if (updatedContextId === contextId) {
        res.write(`data: ${JSON.stringify({ event: 'update', contextId, metadata, timestamp: new Date().toISOString() })}\n\n`);
      }
    };
    
    // Create event handler for context deletions
    const deleteHandler = (deletedContextId) => {
      if (deletedContextId === contextId) {
        res.write(`data: ${JSON.stringify({ event: 'delete', contextId, timestamp: new Date().toISOString() })}\n\n`);
        
        // Close the stream after sending deletion event
        res.end();
        cleanup();
      }
    };
    
    // Function to clean up event listeners
    const cleanup = () => {
      clearInterval(pingInterval);
      contextEvents.off('contextUpdated', updateHandler);
      contextEvents.off('contextDeleted', deleteHandler);
    };
    
    // Register event handlers
    contextEvents.on('contextUpdated', updateHandler);
    contextEvents.on('contextDeleted', deleteHandler);
    
    // Handle client disconnect
    req.on('close', cleanup);
  });
  
  // Stream all context updates (for syncing regional servers)
  app.get('/contexts/stream', (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if used
    
    // Only allow this endpoint for regional and cache servers
    const clientType = req.query.serverType || 'unknown';
    const clientId = req.query.nodeId || 'unknown';
    
    console.log(`New streaming connection from ${clientType} server (ID: ${clientId})`);
    
    // Send an initial connection message
    res.write(`data: ${JSON.stringify({ 
      event: 'connected', 
      timestamp: new Date().toISOString(),
      server: {
        type: config.serverType,
        nodeId: config.nodeId,
        regionId: config.regionId
      }
    })}\n\n`);
    
    // Keep connection alive by sending a ping every 30 seconds
    const pingInterval = setInterval(() => {
      res.write(`data: ${JSON.stringify({ event: 'ping', timestamp: new Date().toISOString() })}\n\n`);
    }, 30000);
    
    // Create event handler for all context updates
    const updateHandler = (contextId, metadata) => {
      res.write(`data: ${JSON.stringify({ 
        event: 'update', 
        contextId, 
        metadata, 
        timestamp: new Date().toISOString() 
      })}\n\n`);
    };
    
    // Create event handler for all context deletions
    const deleteHandler = (contextId) => {
      res.write(`data: ${JSON.stringify({ 
        event: 'delete', 
        contextId, 
        timestamp: new Date().toISOString() 
      })}\n\n`);
    };
    
    // Function to clean up event listeners
    const cleanup = () => {
      console.log(`Closing streaming connection from ${clientType} server (ID: ${clientId})`);
      clearInterval(pingInterval);
      contextEvents.off('contextUpdated', updateHandler);
      contextEvents.off('contextDeleted', deleteHandler);
    };
    
    // Register event handlers
    contextEvents.on('contextUpdated', updateHandler);
    contextEvents.on('contextDeleted', deleteHandler);
    
    // Handle client disconnect
    req.on('close', cleanup);
  });
}

// Initialize and start server
const startServer = async (tailscaleInstance) => {
  await ensureDataDir();
  storage = new ContextStorage(config.dataDir);
  
  // Store the tailscale instance for use in the routes
  app.set('tailscale', tailscaleInstance);
  
  initializeRoutes();
  
  const server = app.listen(config.port, () => {
    console.log(`Context server (${config.serverType}) started on port ${config.port}`);
    console.log(`Node ID: ${config.nodeId}, Region: ${config.regionId}`);
  });

  // Set up sync with central server if needed
  if (config.serverType !== 'central' && tailscaleInstance) {
    // Start syncing with the central server after a short delay
    // to allow the server to fully initialize
    setTimeout(() => {
      setupSyncWithCentral(tailscaleInstance)
        .then(eventSource => {
          if (eventSource) {
            console.log('Real-time sync with central server established');
            // Store the event source for cleanup on server stop
            app.set('centralEventSource', eventSource);
          }
        })
        .catch(err => {
          console.error('Failed to set up sync with central server:', err);
        });
    }, 5000);
  }
  
  return server;
};

// Utility function to discover regional servers via Tailscale
async function discoverRegionalServers(tailscale) {
  try {
    if (!tailscale || !tailscale.isRunning || !tailscale.getPeers) {
      console.warn('Tailscale integration not available for peer discovery');
      return [];
    }
    
    const peers = await tailscale.getPeers();
    
    // Filter for regional servers based on tags
    const regionalServers = peers.filter(peer => 
      peer.online && 
      peer.tags && 
      (peer.tags.includes('tag:regional') || peer.tags.includes('type:regional'))
    );
    
    console.log(`Discovered ${regionalServers.length} regional servers via Tailscale`);
    return regionalServers;
  } catch (error) {
    console.error('Failed to discover regional servers:', error);
    return [];
  }
}

// Utility function to propagate context updates to regional servers
async function propagateToRegionals(tailscale, contextId, context, metadata) {
  try {
    const regionalServers = await discoverRegionalServers(tailscale);
    const propagationResults = [];
    
    for (const server of regionalServers) {
      try {
        // Use the server's Tailscale IP address
        const serverUrl = `http://${server.ip}:${config.port}`;
        
        console.log(`Propagating context ${contextId} to regional server at ${serverUrl}`);
        
        // Send update to regional server
        const response = await axios.put(
          `${serverUrl}/contexts/${contextId}`, 
          { context, metadata },
          { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // 10 seconds timeout
          }
        );
        
        propagationResults.push({
          server: server.name || server.ip,
          success: true,
          statusCode: response.status,
          data: response.data
        });
      } catch (err) {
        console.error(`Failed to propagate context to ${server.name || server.ip}:`, err.message);
        propagationResults.push({
          server: server.name || server.ip,
          success: false,
          error: err.message
        });
      }
    }
    
    return propagationResults;
  } catch (error) {
    console.error('Error in propagation to regional servers:', error);
    throw error;
  }
}

// Utility function to propagate context deletions to regional servers
async function propagateDeletionToRegionals(tailscale, contextId) {
  try {
    const regionalServers = await discoverRegionalServers(tailscale);
    const propagationResults = [];
    
    for (const server of regionalServers) {
      try {
        // Use the server's Tailscale IP address
        const serverUrl = `http://${server.ip}:${config.port}`;
        
        console.log(`Propagating deletion of context ${contextId} to regional server at ${serverUrl}`);
        
        // Send delete request to regional server
        const response = await axios.delete(
          `${serverUrl}/contexts/${contextId}`, 
          { 
            timeout: 10000 // 10 seconds timeout
          }
        );
        
        propagationResults.push({
          server: server.name || server.ip,
          success: true,
          statusCode: response.status,
          data: response.data
        });
      } catch (err) {
        console.error(`Failed to propagate deletion to ${server.name || server.ip}:`, err.message);
        propagationResults.push({
          server: server.name || server.ip,
          success: false,
          error: err.message
        });
      }
    }
    
    return propagationResults;
  } catch (error) {
    console.error('Error in propagating deletion to regional servers:', error);
    throw error;
  }
}

// Function to set up a sync connection with the central server
async function setupSyncWithCentral(tailscale) {
  if (config.serverType === 'central') {
    console.log('This is a central server, no need to sync with central');
    return;
  }
  
  try {
    // Find the central server via Tailscale
    let centralServer = null;
    if (tailscale && tailscale.isRunning) {
      const peers = await tailscale.getPeers();
      centralServer = peers.find(peer => 
        peer.online && 
        peer.tags && 
        (peer.tags.includes('tag:central') || peer.tags.includes('type:central'))
      );
    }
    
    let centralUrl;
    if (centralServer) {
      centralUrl = `http://${centralServer.ip}:${config.port}`;
      console.log(`Found central server via Tailscale at ${centralUrl}`);
    } else {
      centralUrl = config.centralAuthority;
      console.log(`Using configured central server at ${centralUrl}`);
    }
    
    // First, get a list of all contexts from the central server
    console.log('Syncing existing contexts from central server...');
    
    const centralClient = axios.create({
      baseURL: centralUrl,
      timeout: 30000
    });
    
    // Get all contexts with metadata
    const response = await centralClient.get('/contexts?includeMetadata=true');
    const contexts = response.data;
    
    console.log(`Found ${contexts.length} contexts on central server`);
    
    // For each context, check if we have it locally and if it's up to date
    for (const contextInfo of contexts) {
      const { id: contextId, metadata: centralMetadata } = contextInfo;
      
      // Check if we have this context locally
      const localMetadata = await storage.getMetadata(contextId);
      
      if (!localMetadata || localMetadata.version < centralMetadata.version) {
        console.log(`Syncing context ${contextId} (local version: ${localMetadata ? localMetadata.version : 'none'}, central version: ${centralMetadata.version})`);
        
        // Get the full context from central
        const contextResponse = await centralClient.get(`/contexts/${contextId}`);
        const context = contextResponse.data;
        
        // Save it locally
        await storage.saveContext(contextId, context, centralMetadata);
      } else {
        console.log(`Context ${contextId} is up to date (version: ${localMetadata.version})`);
      }
    }
    
    // Now set up a streaming connection to stay in sync
    console.log('Setting up streaming connection for real-time updates...');
    
    // Use EventSource for server-sent events
    const EventSource = require('eventsource');
    const url = new URL('/contexts/stream', centralUrl);
    url.searchParams.append('serverType', config.serverType);
    url.searchParams.append('nodeId', config.nodeId);
    
    const eventSource = new EventSource(url.toString());
    
    eventSource.onopen = () => {
      console.log('Streaming connection established with central server');
    };
    
    eventSource.onerror = (err) => {
      console.error('Streaming connection error:', err);
      // Try to reconnect after a delay
      setTimeout(() => {
        console.log('Attempting to reconnect to central server...');
        eventSource.close();
        setupSyncWithCentral(tailscale);
      }, config.syncInterval);
    };
    
    // Handle context updates
    eventSource.addEventListener('update', async (event) => {
      try {
        const data = JSON.parse(event.data);
        const { contextId, metadata } = data;
        
        console.log(`Received update for context ${contextId} (version: ${metadata.version})`);
        
        // Get the full context from central
        const contextResponse = await centralClient.get(`/contexts/${contextId}`);
        const context = contextResponse.data;
        
        // Save it locally without emitting events (to prevent loops)
        await storage.saveContext(contextId, context, metadata);
      } catch (err) {
        console.error('Error processing context update:', err);
      }
    });
    
    // Handle context deletions
    eventSource.addEventListener('delete', async (event) => {
      try {
        const data = JSON.parse(event.data);
        const { contextId } = data;
        
        console.log(`Received deletion for context ${contextId}`);
        
        // Delete it locally without emitting events (to prevent loops)
        await storage.deleteContext(contextId);
      } catch (err) {
        console.error('Error processing context deletion:', err);
      }
    });
    
    return eventSource;
  } catch (err) {
    console.error('Failed to set up sync with central server:', err);
    
    // Try again after a delay
    console.log(`Will retry in ${config.syncInterval / 1000} seconds`);
    setTimeout(() => {
      setupSyncWithCentral(tailscale);
    }, config.syncInterval);
    
    return null;
  }
}

// Export the server and utility functions
module.exports = class ContextServer {
  constructor(configOptions) {
    // Update config with provided options
    Object.assign(config, configOptions);
  }
  
  async start(tailscaleInstance) {
    this.server = await startServer(tailscaleInstance);
    return this.server;
  }
  
  async stop() {
    if (this.server) {
      // Close any central server event source for sync
      const eventSource = this.server.app && this.server.app.get('centralEventSource');
      if (eventSource) {
        console.log('Closing central server sync connection');
        eventSource.close();
      }
      
      return new Promise((resolve, reject) => {
        this.server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          console.log('Context server stopped');
          resolve();
        });
      });
    }
    return Promise.resolve();
  }
  
  async getContextCount() {
    if (!storage) {
      return 0;
    }
    const contexts = await storage.listContexts();
    return contexts.length;
  }
  
  async getTotalSize() {
    if (!storage) {
      return 0;
    }
    
    const contexts = await storage.listContexts();
    let totalSize = 0;
    
    for (const contextId of contexts) {
      try {
        const metadata = await storage.getMetadata(contextId);
        if (metadata && metadata.size) {
          totalSize += metadata.size;
        }
      } catch (err) {
        console.error(`Error getting size for context ${contextId}:`, err);
      }
    }
    
    return totalSize;
  }
  
  async getMetrics() {
    // Basic metrics for monitoring
    const metrics = [];
    
    metrics.push(`# TYPE context_server_up gauge`);
    metrics.push(`context_server_up{type="${config.serverType}",node="${config.nodeId}",region="${config.regionId}"} 1`);
    
    try {
      const contextCount = await this.getContextCount();
      const totalSize = await this.getTotalSize();
      
      metrics.push(`# TYPE context_server_contexts gauge`);
      metrics.push(`context_server_contexts{type="${config.serverType}",node="${config.nodeId}",region="${config.regionId}"} ${contextCount}`);
      
      metrics.push(`# TYPE context_server_size_bytes gauge`);
      metrics.push(`context_server_size_bytes{type="${config.serverType}",node="${config.nodeId}",region="${config.regionId}"} ${totalSize}`);
    } catch (err) {
      console.error('Error getting metrics:', err);
    }
    
    return metrics.join('\n');
  }
};
