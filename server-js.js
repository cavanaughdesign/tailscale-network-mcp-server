// server.js - Main entry point for the Tailscale-powered Model Context Server
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const TailscaleIntegration = require('./tailscale-integration');

// Import the context server implementation
const ContextServer = require('./context-server');

// Configuration
const config = {
  serverType: process.env.SERVER_TYPE || 'regional', // 'central', 'regional', 'cache'
  dataDir: process.env.DATA_DIR || './data',
  port: parseInt(process.env.PORT || '3000'),
  centralAuthority: process.env.CENTRAL_AUTHORITY || 'http://central-authority.tailnet.ts.net:3000',
  syncInterval: parseInt(process.env.SYNC_INTERVAL || '60000'), // 1 minute by default
  cacheTTL: parseInt(process.env.CACHE_TTL || '3600000'), // 1 hour by default
  nodeId: process.env.NODE_ID || uuidv4(),
  regionId: process.env.REGION_ID || 'default',
  
  // Tailscale configuration
  tailscale: {
    authKey: process.env.TAILSCALE_AUTH_KEY,
    hostname: process.env.TAILSCALE_HOSTNAME || `context-${process.env.SERVER_TYPE || 'server'}-${Math.floor(Math.random() * 10000)}`,
    statePath: process.env.TAILSCALE_STATE_DIR || path.join(process.env.DATA_DIR || './data', 'tailscale'),
    tags: [
      `context-server`,
      `type:${process.env.SERVER_TYPE || 'regional'}`,
      `region:${process.env.REGION_ID || 'default'}`
    ],
    ephemeral: process.env.TAILSCALE_EPHEMERAL !== 'false'
  }
};

// Initialize the Tailscale integration
const tailscale = new TailscaleIntegration(config.tailscale);

// Initialize the context server
const contextServer = new ContextServer(config);

// Create an Express app for additional routes
const app = express();

// Add routes for server management and monitoring
app.get('/', (req, res) => {
  res.json({
    service: 'Tailscale Model Context Server',
    version: '1.0.0',
    status: 'running',
    serverType: config.serverType,
    nodeId: config.nodeId,
    regionId: config.regionId
  });
});

app.get('/status', async (req, res) => {
  try {
    const status = {
      server: {
        type: config.serverType,
        nodeId: config.nodeId,
        regionId: config.regionId,
        uptime: process.uptime()
      },
      tailscale: {
        running: tailscale.isRunning,
        ip: tailscale.ipAddress,
        hostname: tailscale.getHostname()
      }
    };
    
    // Include peer information if available
    if (tailscale.isRunning) {
      try {
        status.tailscale.peers = await tailscale.getPeers();
      } catch (err) {
        console.warn('Failed to get Tailscale peers:', err);
      }
    }
    
    // Include context statistics if available
    try {
      status.contexts = {
        count: await contextServer.getContextCount(),
        totalSize: await contextServer.getTotalSize()
      };
    } catch (err) {
      console.warn('Failed to get context statistics:', err);
    }
    
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: `Failed to get status: ${err.message}` });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await contextServer.getMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ error: `Failed to get metrics: ${err.message}` });
  }
});

// Main function to start everything
async function start() {
  console.log(`Starting Tailscale Model Context Server (${config.serverType})...`);
  console.log(`Node ID: ${config.nodeId}, Region: ${config.regionId}`);
  
  try {
    // Start Tailscale
    console.log('Initializing Tailscale...');
    await tailscale.start();
    console.log(`Tailscale connected with IP: ${tailscale.ipAddress}`);
    
    // Update the central authority URL if needed
    if (config.serverType !== 'central' && !process.env.CENTRAL_AUTHORITY) {
      const centralPeer = await tailscale.findPeer('central');
      if (centralPeer && centralPeer.ip) {
        config.centralAuthority = `http://${centralPeer.ip}:${config.port}`;
        console.log(`Auto-discovered central authority: ${config.centralAuthority}`);
      }
    }
    
    // Start the context server with Tailscale instance
    console.log('Starting context server...');
    await contextServer.start(tailscale);
    
    // Start the management API
    app.listen(config.port + 1, () => {
      console.log(`Management API listening on port ${config.port + 1}`);
    });
    
    console.log('Server started successfully');
  } catch (err) {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  
  // Stop the context server
  contextServer.stop()
    .then(() => {
      console.log('Context server stopped');
      return tailscale.stop();
    })
    .then(() => {
      console.log('Tailscale stopped');
      process.exit(0);
    })
    .catch(err => {
      console.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    });
}

// Setup signal handlers
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server
start().catch(err => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
