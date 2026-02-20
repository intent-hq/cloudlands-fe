/**
 * Real-time Monitoring Dashboard
 *
 * Provides a web-based dashboard for monitoring parallel agent execution
 * with live updates, metrics, and progress visualization.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Logger } = require('../utils/logger');

class Monitor {
  constructor(portOrConfig, config) {
    // Handle overloaded constructor
    if (typeof portOrConfig === 'number') {
      this.port = portOrConfig;
      this.config = config || {};
    } else {
      this.config = portOrConfig || {};
      this.port = process.env.MONITOR_PORT || 3456;
    }

    this.logger = new Logger('Monitor');

    // State
    this.state = {
      status: 'initializing',
      startTime: Date.now(),
      waves: [],
      packages: {},
      metrics: {
        total: this.config.packages ? this.config.packages.length : 0,
        completed: 0,
        failed: 0,
        running: 0,
        pending: this.config.packages ? this.config.packages.length : 0
      }
    };

    // Initialize packages array for tests
    this.packages = [];
    this.metrics = this.state.metrics;

    // Setup Express app
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });

    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'public')));

    // API endpoints
    this.app.get('/api/state', (req, res) => {
      res.json(this.getState());
    });

    this.app.get('/api/packages', (req, res) => {
      res.json(Object.values(this.state.packages));
    });

    this.app.get('/api/metrics', (req, res) => {
      res.json(this.getMetrics());
    });

    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });
  }

  /**
   * Setup WebSocket for real-time updates
   */
  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.logger.debug('WebSocket client connected');

      // Send initial state
      ws.send(JSON.stringify({
        type: 'state',
        data: this.getState()
      }));

      // Handle client messages
      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message);
          this.handleClientMessage(ws, msg);
        } catch (error) {
          this.logger.error('Invalid WebSocket message:', error);
        }
      });

      ws.on('close', () => {
        this.logger.debug('WebSocket client disconnected');
      });
    });
  }

  /**
   * Start the monitoring server
   */
  async start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.logger.info(`Monitoring dashboard started on port ${this.port}`);
        this.state.status = 'running';
        resolve();
      });
    });
  }

  /**
   * Stop the monitoring server
   */
  async stop() {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => {
        this.logger.info('Monitoring dashboard stopped');
        resolve();
      });
    });
  }

  /**
   * Update wave information
   */
  updateWave(waveNumber, wave) {
    this.state.waves[waveNumber - 1] = {
      number: waveNumber,
      packages: wave.packages.map(p => p.id),
      startTime: Date.now(),
      status: 'running'
    };

    this.broadcast({
      type: 'wave_update',
      data: this.state.waves[waveNumber - 1]
    });
  }

  /**
   * Update package status
   */
  updatePackage(packageId, updates) {
    // Handle both state.packages object and packages array
    if (Array.isArray(this.packages)) {
      const pkg = this.packages.find(p => p.id === packageId);
      if (pkg) {
        Object.assign(pkg, updates);
      }
    }

    // Also update state.packages
    if (!this.state.packages[packageId]) {
      this.state.packages[packageId] = { id: packageId };
    }
    Object.assign(this.state.packages[packageId], updates);

    // Update metrics
    this.updateMetrics();

    this.broadcast({
      type: 'package_update',
      package: this.state.packages[packageId]
    });
  }

  /**
   * Update metrics based on package states
   */
  updateMetrics() {
    const packages = Object.values(this.state.packages);
    const totalPackages = (this.config && this.config.packages) ? this.config.packages.length : 0;

    this.state.metrics = {
      total: totalPackages,
      completed: packages.filter(p => p.status === 'completed').length,
      failed: packages.filter(p => p.status === 'failed').length,
      running: packages.filter(p => p.status === 'running').length,
      pending: totalPackages - packages.length
    };
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Handle client messages
   */
  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'get_logs':
        // TODO: Implement log streaming
        break;
      default:
        this.logger.debug(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Get current state
   */
  getState() {
    return {
      ...this.state,
      uptime: Date.now() - this.state.startTime,
      config: {
        title: this.config.title,
        description: this.config.description,
        maxParallel: this.config.config?.maxParallel || 4
      }
    };
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const packages = Object.values(this.state.packages);
    const durations = packages
      .filter(p => p.endTime)
      .map(p => p.endTime - p.startTime);

    return {
      ...this.state.metrics,
      averageDuration: durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      totalDuration: Date.now() - this.state.startTime
    };
  }

  /**
   * Generate dashboard HTML
   */
  getDashboardHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parallel Agent Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .subtitle { opacity: 0.9; }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .metric {
      background: #1a1a1a;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #333;
    }
    .metric-value {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .metric-label {
      color: #888;
      text-transform: uppercase;
      font-size: 12px;
    }
    .waves {
      background: #1a1a1a;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      border: 1px solid #333;
    }
    .wave {
      padding: 15px;
      margin-bottom: 10px;
      background: #222;
      border-radius: 6px;
      border-left: 4px solid #667eea;
    }
    .packages {
      display: grid;
      gap: 10px;
    }
    .package {
      background: #1a1a1a;
      padding: 15px;
      border-radius: 6px;
      border: 1px solid #333;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .package.running { border-color: #667eea; background: #1a1a2e; }
    .package.completed { border-color: #10b981; }
    .package.failed { border-color: #ef4444; }
    .status {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: bold;
    }
    .status.running { background: #667eea; }
    .status.completed { background: #10b981; }
    .status.failed { background: #ef4444; }
    .status.pending { background: #666; }
    .progress-bar {
      height: 8px;
      background: #333;
      border-radius: 4px;
      overflow: hidden;
      margin: 20px 0;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      transition: width 0.3s ease;
    }
    .timer { font-family: monospace; color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Parallel Agent Monitor</h1>
      <div class="subtitle" id="title">Loading...</div>
      <div class="timer" id="timer">00:00:00</div>
    </div>

    <div class="metrics" id="metrics">
      <div class="metric">
        <div class="metric-value" id="metric-total">0</div>
        <div class="metric-label">Total</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="metric-running" style="color: #667eea">0</div>
        <div class="metric-label">Running</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="metric-completed" style="color: #10b981">0</div>
        <div class="metric-label">Completed</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="metric-failed" style="color: #ef4444">0</div>
        <div class="metric-label">Failed</div>
      </div>
      <div class="metric">
        <div class="metric-value" id="metric-pending" style="color: #888">0</div>
        <div class="metric-label">Pending</div>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="progress" style="width: 0%"></div>
    </div>

    <div class="waves" id="waves">
      <h2>Waves</h2>
      <div id="waves-content"></div>
    </div>

    <div class="packages" id="packages"></div>
  </div>

  <script>
    const ws = new WebSocket('ws://localhost:${this.port}');
    let state = {};
    let startTime = Date.now();

    ws.onopen = () => {
      console.log('Connected to monitor');
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleMessage(message);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    function handleMessage(message) {
      switch (message.type) {
        case 'state':
          state = message.data;
          startTime = Date.now() - state.uptime;
          updateUI();
          break;
        case 'package_update':
          if (!state.packages) state.packages = {};
          state.packages[message.data.id] = message.data;
          updatePackage(message.data);
          updateMetrics();
          break;
        case 'wave_update':
          if (!state.waves) state.waves = [];
          state.waves[message.data.number - 1] = message.data;
          updateWaves();
          break;
      }
    }

    function updateUI() {
      // Update title
      document.getElementById('title').textContent =
        state.config?.title || 'Parallel Agent Execution';

      // Update metrics
      updateMetrics();

      // Update waves
      updateWaves();

      // Update packages
      updatePackages();
    }

    function updateMetrics() {
      const metrics = state.metrics || {};
      document.getElementById('metric-total').textContent = metrics.total || 0;
      document.getElementById('metric-running').textContent = metrics.running || 0;
      document.getElementById('metric-completed').textContent = metrics.completed || 0;
      document.getElementById('metric-failed').textContent = metrics.failed || 0;
      document.getElementById('metric-pending').textContent = metrics.pending || 0;

      // Update progress bar
      const progress = metrics.total > 0
        ? ((metrics.completed + metrics.failed) / metrics.total) * 100
        : 0;
      document.getElementById('progress').style.width = progress + '%';
    }

    function updateWaves() {
      const container = document.getElementById('waves-content');
      if (!state.waves) return;

      container.innerHTML = state.waves.map(wave => \`
        <div class="wave">
          <strong>Wave \${wave.number}</strong>
          <div>Packages: \${wave.packages.join(', ')}</div>
          <div>Status: \${wave.status}</div>
        </div>
      \`).join('');
    }

    function updatePackages() {
      const container = document.getElementById('packages');
      if (!state.packages) return;

      const packages = Object.values(state.packages);
      container.innerHTML = packages.map(pkg => \`
        <div class="package \${pkg.status}">
          <div>
            <strong>\${pkg.name || pkg.id}</strong>
            <div style="color: #888; font-size: 12px">Wave \${pkg.waveNumber}</div>
          </div>
          <span class="status \${pkg.status}">\${pkg.status}</span>
        </div>
      \`).join('');
    }

    function updatePackage(pkg) {
      // Could update individual package without full re-render
      updatePackages();
    }

    // Update timer
    setInterval(() => {
      const elapsed = Date.now() - startTime;
      const hours = Math.floor(elapsed / 3600000);
      const minutes = Math.floor((elapsed % 3600000) / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);

      document.getElementById('timer').textContent =
        \`\${String(hours).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:\${String(seconds).padStart(2, '0')}\`;
    }, 1000);

    // Ping to keep connection alive
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  </script>
</body>
</html>`;
  }
}

module.exports = { Monitor };
