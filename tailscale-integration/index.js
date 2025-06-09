// tailscale-integration/index.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

class TailscaleIntegration {
  /**
   * Integration with Tailscale for secure networking
   * @param {Object} options - Configuration options
   * @param {string} options.authKey - Tailscale auth key (optional)
   * @param {string} options.hostname - Hostname to use in the tailnet
   * @param {string} options.statePath - Path to store Tailscale state
   * @param {string} options.tailnetName - Name of the tailnet to join
   * @param {Array<string>} options.tags - Tags to apply to this node
   * @param {boolean} options.ephemeral - Whether to use ephemeral mode
   */
  constructor(options = {}) {
    this.authKey = options.authKey;
    this.hostname = options.hostname || `context-server-${Math.floor(Math.random() * 10000)}`;
    this.statePath = options.statePath || path.join(os.tmpdir(), 'tailscale-state');
    this.tailnetName = options.tailnetName || 'context-server-net';
    this.tags = options.tags || [];
    this.ephemeral = options.ephemeral !== false;
    
    this.isRunning = false;
    this.tailscaleProcess = null;
    this.ipAddress = null;
    this.peerList = [];
  /**
   * Start Tailscale and connect to the tailnet
   * @returns {Promise<string>} - IP address assigned by Tailscale
   */
  async start() {
    if (this.isRunning) {
      console.log('Tailscale is already running');
      return this.ipAddress;
    }
    
    // Ensure Tailscale is installed
    if (!(await this.isTailscaleInstalled())) {
      await this.installTailscale();
    }
    
    // Make sure state directory exists
    if (!fs.existsSync(this.statePath)) {
      fs.mkdirSync(this.statePath, { recursive: true });
    }
    
    // Build command arguments
    const args = [
      'up',
      '--hostname', this.hostname,
      '--state-dir', this.statePath
    ];
    
    // Add optional arguments
    if (this.authKey) {
      args.push('--authkey', this.authKey);
    }
    
    if (this.ephemeral) {
      args.push('--ephemeral');
    }
    
    if (this.tags.length > 0) {
      args.push('--advertise-tags', this.tags.join(','));
    }
    
    console.log(`Starting Tailscale with arguments: ${args.join(' ')}`);
    
    return new Promise((resolve, reject) => {
      // Start Tailscale process
      this.tailscaleProcess = spawn('tailscale', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      this.tailscaleProcess.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        console.log(`Tailscale stdout: ${chunk.trim()}`);
      });
      
      this.tailscaleProcess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        console.error(`Tailscale stderr: ${chunk.trim()}`);
      });
      
      this.tailscaleProcess.on('close', (code) => {
        if (code !== 0) {
          this.isRunning = false;
          reject(new Error(`Tailscale exited with code ${code}: ${stderr}`));
          return;
        }
        
        // Get IP address
        this.getIPAddress()
          .then((ip) => {
            this.ipAddress = ip;
            this.isRunning = true;
            console.log(`Tailscale connected with IP: ${ip}`);
            resolve(ip);
          })
          .catch(reject);
      });
    });
  }
  
  /**
   * Stop Tailscale
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      console.log('Tailscale is not running');
      return;
    }
    
    console.log('Stopping Tailscale...');
    
    try {
      execSync('tailscale down', { stdio: 'inherit' });
      
      if (this.tailscaleProcess) {
        this.tailscaleProcess.kill();
        this.tailscaleProcess = null;
      }
      
      this.isRunning = false;
      this.ipAddress = null;
      console.log('Tailscale stopped successfully');
    } catch (error) {
      console.error(`Failed to stop Tailscale: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get the current Tailscale IP address
   * @returns {Promise<string>} - IP address
   */
  async getIPAddress() {
    try {
      const output = execSync('tailscale ip -4', { encoding: 'utf8' }).trim();
      return output;
    } catch (error) {
      throw new Error(`Failed to get Tailscale IP address: ${error.message}`);
    }
  }
  
  /**
   * Get the status of the Tailscale connection
   * @returns {Promise<Object>} - Status information
   */
  async getStatus() {
    try {
      const output = execSync('tailscale status --json', { encoding: 'utf8' });
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Failed to get Tailscale status: ${error.message}`);
    }
  }
  
  /**
   * Get a list of peers in the tailnet
   * @returns {Promise<Array>} - List of peers
   */
  async getPeers() {
    try {
      const status = await this.getStatus();
      
      // Extract peer information
      this.peerList = Object.values(status.Peer || {}).map(peer => ({
        name: peer.HostName,
        ip: peer.TailscaleIPs && peer.TailscaleIPs.length > 0 ? peer.TailscaleIPs[0] : null,
        online: peer.Online,
        lastSeen: peer.LastSeen,
        tags: peer.Tags || []
      }));
      
      return this.peerList;
    } catch (error) {
      throw new Error(`Failed to get peer list: ${error.message}`);
    }
  }
  
  /**
   * Find a peer by name or tag
   * @param {string} nameOrTag - Name or tag to search for
   * @returns {Promise<Object|null>} - Peer information or null if not found
   */
  async findPeer(nameOrTag) {
    const peers = await this.getPeers();
    
    return peers.find(peer => 
      peer.name === nameOrTag || 
      (peer.tags && peer.tags.includes(nameOrTag))
    ) || null;
  }
  
  /**
   * Check if a peer is reachable
   * @param {string} peerIP - IP address of the peer
   * @returns {Promise<boolean>} - Whether the peer is reachable
   */
  async isPeerReachable(peerIP) {
    try {
      // Simple ping via HTTP request
      await axios.get(`http://${peerIP}:3000/health`, { timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Get the tailscale hostname for this node
   * @returns {string} - Hostname
   */
  getHostname() {
    return this.hostname;
  }
}
  
  /**
   * Check if Tailscale is installed
   * @returns {boolean} - Whether Tailscale is installed
   */
  async isTailscaleInstalled() {
    try {
      execSync('tailscale version', { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Install Tailscale if not already installed
   * Supports basic installation on common platforms
   */
  async installTailscale() {
    if (await this.isTailscaleInstalled()) {
      console.log('Tailscale is already installed');
      return;
    }
    
    const platform = os.platform();
    
    try {
      if (platform === 'linux') {
        // Check for common package managers
        if (fs.existsSync('/usr/bin/apt')) {
          console.log('Installing Tailscale via apt...');
          execSync('curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.gpg | sudo apt-key add -', { stdio: 'inherit' });
          execSync('curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.list | sudo tee /etc/apt/sources.list.d/tailscale.list', { stdio: 'inherit' });
          execSync('sudo apt-get update', { stdio: 'inherit' });
          execSync('sudo apt-get install -y tailscale', { stdio: 'inherit' });
        } else if (fs.existsSync('/usr/bin/yum')) {
          console.log('Installing Tailscale via yum...');
          execSync('sudo yum install -y yum-utils', { stdio: 'inherit' });
          execSync('sudo yum-config-manager --add-repo https://pkgs.tailscale.com/stable/centos/tailscale.repo', { stdio: 'inherit' });
          execSync('sudo yum install -y tailscale', { stdio: 'inherit' });
        } else {
          throw new Error('Unsupported Linux distribution');
        }
      } else if (platform === 'darwin') {
        console.log('Installing Tailscale via Homebrew...');
        execSync('brew install tailscale', { stdio: 'inherit' });
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      
      console.log('Tailscale installed successfully');
    } catch (error) {
      console.error(`Failed to install Tailscale: ${error.message}`);
      throw error;
    }
  }