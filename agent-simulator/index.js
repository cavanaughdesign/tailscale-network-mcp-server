// agent-simulator/index.js
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const ContextClient = require('../context-client');
const TailscaleIntegration = require('../tailscale-integration');

// Create Express app
const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuration
const config = {
  port: process.env.PORT || 8080,
  contextServer: process.env.CONTEXT_SERVER || 'http://context-server.tailnet.ts.net:3000',
  agentId: process.env.AGENT_ID || `agent-${uuidv4().substring(0, 8)}`,
  
  // Tailscale configuration
  tailscale: {
    authKey: process.env.TAILSCALE_AUTH_KEY,
    hostname: process.env.TAILSCALE_HOSTNAME || `ai-agent-${Math.floor(Math.random() * 10000)}`,
    statePath: process.env.TAILSCALE_STATE_DIR || './data/tailscale',
    tags: ['ai-agent'],
    ephemeral: true
  }
};

// Initialize Tailscale
const tailscale = new TailscaleIntegration(config.tailscale);

// Initialize Context Client
let contextClient;

// In-memory store for simulation
const conversations = new Map();
const activeContexts = new Map();

// Helper to generate a sample context
function generateSampleContext() {
  return {
    timestamp: new Date().toISOString(),
    embeddings: Array.from({ length: 10 }, () => Math.random()),
    tokens: Array.from({ length: 100 }, () => Math.floor(Math.random() * 50000)),
    metadata: {
      source: 'simulation',
      type: 'generated',
      creator: config.agentId
    }
  };
}

// Helper to simulate context processing
function processContext(context) {
  // Simulate processing the context
  const processedTokens = context.tokens.map(t => t * 1.5);
  const result = {
    processed: true,
    source: context,
    output: {
      tokens: processedTokens,
      score: Math.random() * 0.8 + 0.2,
      confidence: Math.random() * 0.5 + 0.5
    }
  };
  return result;
}

// Setup routes
app.get('/', (req, res) => {
  res.json({
    service: 'AI Agent Simulator',
    id: config.agentId,
    status: 'running',
    contextServer: config.contextServer,
    tailscaleIP: tailscale.ipAddress
  });
});

// Create a new conversation
app.post('/conversations', (req, res) => {
  const conversationId = uuidv4();
  conversations.set(conversationId, {
    id: conversationId,
    created: new Date().toISOString(),
    messages: [],
    contexts: []
  });
  
  res.json({ conversationId });
});

// Add a message to a conversation
app.post('/conversations/:conversationId/messages', async (req, res) => {
  const { conversationId } = req.params;
  const { message, useContext } = req.body;
  
  if (!conversations.has(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  const conversation = conversations.get(conversationId);
  
  // Generate a new context if requested
  let contextId = null;
  if (useContext) {
    try {
      // Create a new context
      contextId = `context-${uuidv4()}`;
      const context = generateSampleContext();
      
      // Save to context server
      await contextClient.saveContext(contextId, context, {
        conversationId,
        agentId: config.agentId,
        messageIndex: conversation.messages.length
      });
      
      // Track active context
      activeContexts.set(contextId, {
        id: contextId,
        conversation: conversationId,
        timestamp: new Date().toISOString()
      });
      
      // Add to conversation
      conversation.contexts.push(contextId);
      
      console.log(`Created new context: ${contextId}`);
    } catch (error) {
      console.error(`Failed to create context: ${error.message}`);
    }
  }
  
  // Add message to conversation
  const messageObj = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    content: message,
    contextId
  };
  
  conversation.messages.push(messageObj);
  
  res.json({ 
    message: messageObj,
    conversation: {
      id: conversationId,
      messageCount: conversation.messages.length,
      contextCount: conversation.contexts.length
    }
  });
});

// Retrieve a context and process it
app.get('/contexts/:contextId/process', async (req, res) => {
  const { contextId } = req.params;
  
  try {
    // Get the context from the server
    const context = await contextClient.getContext(contextId);
    
    if (!context) {
      return res.status(404).json({ error: 'Context not found' });
    }
    
    // Process the context
    const result = processContext(context);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: `Failed to process context: ${error.message}` });
  }
});

// List all contexts for this agent
app.get('/contexts', async (req, res) => {
  try {
    // Get all contexts from the context server
    const contexts = await contextClient.listContexts({ includeMetadata: true });
    
    // Filter for this agent's contexts
    const agentContexts = contexts.filter(ctx => 
      ctx.metadata && ctx.metadata.agentId === config.agentId
    );
    
    res.json(agentContexts);
  } catch (error) {
    res.status(500).json({ error: `Failed to list contexts: ${error.message}` });
  }
});

// List all conversations
app.get('/conversations', (req, res) => {
  const conversationList = Array.from(conversations.values()).map(conv => ({
    id: conv.id,
    created: conv.created,
    messageCount: conv.messages.length,
    contextCount: conv.contexts.length
  }));
  
  res.json(conversationList);
});

// Get a specific conversation
app.get('/conversations/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  
  if (!conversations.has(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  
  res.json(conversations.get(conversationId));
});

// Agent status and health check
app.get('/status', async (req, res) => {
  try {
    const status = {
      agent: {
        id: config.agentId,
        uptime: process.uptime()
      },
      tailscale: {
        running: tailscale.isRunning,
        ip: tailscale.ipAddress,
        hostname: tailscale.getHostname()
      },
      contextServer: {
        url: config.contextServer,
        connected: false
      },
      stats: {
        conversations: conversations.size,
        activeContexts: activeContexts.size
      }
    };
    
    // Check context server connection
    try {
      await contextClient.listContexts({ limit: 1 });
      status.contextServer.connected = true;
    } catch (err) {
      status.contextServer.connected = false;
      status.contextServer.error = err.message;
    }
    
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: `Failed to get status: ${err.message}` });
  }
});

// Start server
async function start() {
  console.log(`Starting AI Agent Simulator...`);
  console.log(`Agent ID: ${config.agentId}`);
  
  try {
    // Start Tailscale
    console.log('Initializing Tailscale...');
    await tailscale.start();
    console.log(`Tailscale connected with IP: ${tailscale.ipAddress}`);
    
    // Initialize context client
    contextClient = new ContextClient({
      baseUrl: config.contextServer,
      enableCache: true
    });
    
    // Start the web server
    app.listen(config.port, () => {
      console.log(`Agent simulator running on port ${config.port}`);
    });
    
    console.log('Agent started successfully');
  } catch (err) {
    console.error(`Failed to start agent: ${err.message}`);
    process.exit(1);
  }
}

// Handle graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  
  // Close context client
  if (contextClient) {
    contextClient.close();
  }
  
  // Stop Tailscale
  tailscale.stop()
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

// Start the agent
start().catch(err => {
  console.error(`Failed to start: ${err.message}`);
  process.exit(1);
});
