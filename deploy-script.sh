#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Tailscale-Powered Model Context Server Deployment${NC}"
echo "======================================================"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi
echo "✅ Docker is installed"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi
echo "✅ Docker Compose is installed"

# Check for Tailscale auth key
if [ -z "$TAILSCALE_AUTH_KEY" ]; then
    echo -e "${YELLOW}TAILSCALE_AUTH_KEY environment variable is not set.${NC}"
    read -p "Enter your Tailscale auth key: " TAILSCALE_AUTH_KEY
    
    if [ -z "$TAILSCALE_AUTH_KEY" ]; then
        echo -e "${RED}Tailscale auth key is required.${NC}"
        exit 1
    fi
    
    # Export for docker-compose
    export TAILSCALE_AUTH_KEY
fi
echo "✅ Tailscale auth key is set"

# Create .env file
echo -e "${YELLOW}Creating .env file...${NC}"
cat > .env << EOF
TAILSCALE_AUTH_KEY=${TAILSCALE_AUTH_KEY}
EOF
echo "✅ Created .env file"

# Deployment mode selection
echo -e "${YELLOW}Select deployment mode:${NC}"
echo "1) Full deployment (Central + Regional + Edge + Agent)"
echo "2) Minimal deployment (Central + Agent only)"
echo "3) Development environment"
read -p "Enter your choice (1-3): " DEPLOYMENT_MODE

case $DEPLOYMENT_MODE in
    1)
        COMPOSE_FILE="docker-compose.yml"
        ;;
    2)
        echo -e "${YELLOW}Creating minimal docker-compose.yml...${NC}"
        cat > docker-compose.minimal.yml << EOF
version: '3.8'

services:
  central-authority:
    build:
      context: .
      dockerfile: Dockerfile
    image: tailscale-context-server
    container_name: context-server-central
    environment:
      - SERVER_TYPE=central
      - PORT=3000
      - DATA_DIR=/data
      - NODE_ID=central-1
      - REGION_ID=global
      - TAILSCALE_AUTH_KEY=\${TAILSCALE_AUTH_KEY}
      - TAILSCALE_HOSTNAME=context-central
      - TAILSCALE_EXTRA_ARGS=--advertise-tags=tag:central
    volumes:
      - central-data:/data
    ports:
      - "3000:3000"
      - "3001:3001"
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    networks:
      - context-net

  ai-agent-simulator:
    build:
      context: ./agent-simulator
      dockerfile: Dockerfile
    image: ai-agent-simulator
    container_name: ai-agent
    environment:
      - CONTEXT_SERVER=http://context-server-central:3000
      - TAILSCALE_AUTH_KEY=\${TAILSCALE_AUTH_KEY}
      - TAILSCALE_HOSTNAME=ai-agent
      - TAILSCALE_EXTRA_ARGS=--advertise-tags=tag:agent
    ports:
      - "8080:8080"
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    depends_on:
      - central-authority
    networks:
      - context-net

volumes:
  central-data:

networks:
  context-net:
    driver: bridge
EOF
        COMPOSE_FILE="docker-compose.minimal.yml"
        echo "✅ Created minimal docker-compose.yml"
        ;;
    3)
        echo -e "${YELLOW}Setting up development environment...${NC}"
        # Check for Node.js
        if ! command -v node &> /dev/null; then
            echo -e "${RED}Node.js is not installed. Please install Node.js first.${NC}"
            exit 1
        fi
        
        # Install dependencies
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
        
        cd agent-simulator
        npm install
        cd ..
        
        echo "✅ Development environment set up"
        echo -e "${GREEN}To start the servers:${NC}"
        echo "  npm run start:central     # Start central server"
        echo "  npm run start:regional    # Start regional server"
        echo "  npm run start:cache       # Start edge cache"
        echo "  cd agent-simulator && npm start   # Start agent simulator"
        
        # Exit early for dev environment
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid selection.${NC}"
        exit 1
        ;;
esac

# Build and start containers
echo -e "${YELLOW}Building and starting containers...${NC}"
docker-compose -f $COMPOSE_FILE build
docker-compose -f $COMPOSE_FILE up -d

echo -e "${GREEN}Checking container status...${NC}"
sleep 5
docker-compose -f $COMPOSE_FILE ps

echo ""
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo "======================================================"
echo -e "AI Agent Simulator is available at: ${YELLOW}http://localhost:8080${NC}"
echo -e "Central Context Server is available at: ${YELLOW}http://localhost:3000${NC}"
echo -e "Management API is available at: ${YELLOW}http://localhost:3001${NC}"

if [ "$DEPLOYMENT_MODE" -eq "1" ]; then
    echo -e "Region A Context Server is available at: ${YELLOW}http://localhost:3010${NC}"
    echo -e "Region B Context Server is available at: ${YELLOW}http://localhost:3020${NC}"
    echo -e "Edge Cache is available at: ${YELLOW}http://localhost:3030${NC}"
fi

echo ""
echo -e "To view logs: ${YELLOW}docker-compose -f $COMPOSE_FILE logs -f${NC}"
echo -e "To stop the system: ${YELLOW}docker-compose -f $COMPOSE_FILE down${NC}"
