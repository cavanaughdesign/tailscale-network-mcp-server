# Tailscale Network-Powered Model Context Server

A distributed model context server for AI agents, leveraging Tailscale for secure networking.

## Architecture

This project implements a distributed model context server with the following components:

- **Central Context Authority**: The primary context server that handles versioning and consistency
- **Regional Context Servers**: Servers deployed in different regions/environments for lower latency access
- **Edge Context Caches**: Local caching servers for frequently accessed context
- **AI Agent Simulator**: A simulated AI agent that interacts with the context server

All components are connected via a secure Tailscale network, allowing them to communicate seamlessly across different environments (cloud, on-premise, edge) while maintaining zero-trust security.

![Architecture Diagram](./architecture-diagram.png)

## Features

- **Secure Context Access**: All context access is authenticated and encrypted via Tailscale
- **Distributed Storage**: Context can be stored and accessed across multiple environments
- **Caching**: Edge caching for frequently accessed context to reduce latency
- **Real-time Updates**: Changes to context are propagated in real-time to relevant servers
- **Context Versioning**: Track changes to context over time
- **Zero-Trust Networking**: Tailscale provides secure networking without exposing services to the public internet

## Prerequisites

- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/)
- [Tailscale](https://tailscale.com/) account and auth key
- Node.js (for local development)

## Setup

1. Clone this repository:

   ```
   git clone https://github.com/yourusername/tailscale-model-context-server.git
   cd tailscale-model-context-server
   ```

2. Create a `.env` file with your Tailscale auth key:

   ```
   TAILSCALE_AUTH_KEY=tskey-auth-xxxxxxxxxxxxxx
   ```

3. Start the containers:

   ```
   docker-compose up -d
   ```

4. Access the AI Agent Simulator:

   ```
   http://localhost:8080
   ```

## System Components

### Context Server

The context server is responsible for storing and retrieving context data. It has three deployment modes:

- **Central**: The main authority for context data
- **Regional**: Regional servers for lower latency access
- **Cache**: Edge caches for frequently accessed context

### Tailscale Integration

The Tailscale integration handles secure networking between components:

- Automatic discovery of other context servers in the tailnet
- Authentication and encryption of all traffic
- NAT traversal for communication across different networks

### AI Agent

The AI agent simulator demonstrates how an agent would interact with the context server:

- Create and manage conversation contexts
- Store and retrieve context data
- Process context for simulated AI tasks

## Deployment Options

### Local Development

For local development, you can run the components individually:

```bash
# Start the central server
npm run start:central

# Start a regional server
npm run start:regional

# Start an edge cache
npm run start:cache

# Start the agent simulator
cd agent-simulator
npm run start
```

### Docker Deployment

Use Docker Compose to start the entire system:

```bash
docker-compose up -d
```

### Cloud Deployment

For production deployment, you can use:

- **AWS**: Deploy using ECS or EKS
- **GCP**: Deploy using GKE
- **Azure**: Deploy using AKS
- **Hybrid**: Deploy across multiple environments, connected via Tailscale

## API Documentation

### Context Server API

- `GET /contexts/:contextId` - Get a context by ID
- `PUT /contexts/:contextId` - Create or update a context
- `DELETE /contexts/:contextId` - Delete a context
- `GET /contexts` - List available contexts
- `GET /contexts/:contextId/metadata` - Get context metadata
- `GET /contexts/:contextId/stream` - Stream updates for a context

### AI Agent API

- `POST /conversations` - Create a new conversation
- `GET /conversations` - List conversations
- `GET /conversations/:conversationId` - Get a conversation
- `POST /conversations/:conversationId/messages` - Add a message to a conversation
- `GET /contexts/:contextId/process` - Process a context
- `GET /status` - Get agent status

## License

MIT
