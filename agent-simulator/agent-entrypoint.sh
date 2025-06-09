#!/bin/bash
set -e

# Start tailscaled in the background
echo "Starting tailscaled..."
tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/var/run/tailscale/tailscaled.sock &
TAILSCALED_PID=$!

# Function to handle shutdown
function cleanup() {
  echo "Stopping tailscale..."
  tailscale down
  
  echo "Stopping tailscaled (PID: $TAILSCALED_PID)..."
  kill -TERM $TAILSCALED_PID
  
  echo "Stopping Node.js application..."
  kill -TERM $NODE_PID
  
  exit 0
}

# Setup signal handlers
trap cleanup SIGTERM SIGINT

# Wait for tailscaled to start
sleep 2

# Start tailscale with the provided auth key
if [ ! -z "$TAILSCALE_AUTH_KEY" ]; then
  echo "Authenticating with Tailscale..."
  tailscale up \
    --authkey="$TAILSCALE_AUTH_KEY" \
    --hostname="$HOSTNAME" \
    ${TAILSCALE_EXTRA_ARGS}
else
  echo "No Tailscale auth key provided, running in local mode..."
  tailscale up \
    --hostname="$HOSTNAME" \
    --login-server="${TAILSCALE_LOGIN_SERVER:-https://login.tailscale.com}" \
    ${TAILSCALE_EXTRA_ARGS}
fi

# Get the tailscale IP
TAILSCALE_IP=$(tailscale ip -4)
echo "Tailscale IP: $TAILSCALE_IP"

# Find the context server in the tailnet if not explicitly set
if [[ "$CONTEXT_SERVER" == *"tailnet.ts.net"* ]]; then
  echo "Looking for context server in the tailnet..."
  # Try to find a central or regional server
  SERVER_HOST=$(tailscale status --json | jq -r '.Peer[] | select(.Tags[] | contains("context-server")) | .HostName' | head -n 1)
  if [ ! -z "$SERVER_HOST" ]; then
    export CONTEXT_SERVER="http://${SERVER_HOST}:3000"
    echo "Found context server: $CONTEXT_SERVER"
  fi
fi

# Print configuration
echo "Starting AI agent simulator with configuration:"
echo "  AGENT_ID: $AGENT_ID"
echo "  PORT: $PORT"
echo "  CONTEXT_SERVER: $CONTEXT_SERVER"

# Start the Node.js application
echo "Starting Node.js application..."
node index.js &
NODE_PID=$!

# Wait for process to exit
wait $NODE_PID
