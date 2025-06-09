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

# Set Tailnet-specific environment variables
export TAILSCALE_IP=$TAILSCALE_IP
export TAILSCALE_HOSTNAME=$(tailscale status --self --json | jq -r '.Self.HostName')

# For regional and cache servers, set central authority
if [ "$SERVER_TYPE" != "central" ] && [ -z "$CENTRAL_AUTHORITY" ]; then
  # Try to find central authority in the tailnet
  CENTRAL_HOST=$(tailscale status --json | jq -r '.Peer[] | select(.Tags[] | contains("central")) | .HostName' | head -n 1)
  if [ ! -z "$CENTRAL_HOST" ]; then
    export CENTRAL_AUTHORITY="http://${CENTRAL_HOST}:${PORT:-3000}"
    echo "Auto-discovered central authority: $CENTRAL_AUTHORITY"
  fi
fi

# Print configuration
echo "Starting context server with configuration:"
echo "  SERVER_TYPE: $SERVER_TYPE"
echo "  PORT: $PORT"
echo "  DATA_DIR: $DATA_DIR"
echo "  REGION_ID: $REGION_ID"
echo "  NODE_ID: $NODE_ID"
echo "  CENTRAL_AUTHORITY: $CENTRAL_AUTHORITY"

# Start the Node.js application
echo "Starting Node.js application..."
node server.js &
NODE_PID=$!

# Wait for process to exit
wait $NODE_PID
