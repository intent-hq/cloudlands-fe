/**
 * Tests for Monitor Dashboard
 */

const { Monitor } = require('../lib/monitor/monitor');
const http = require('http');
const WebSocket = require('ws');

describe('Monitor', () => {
  let monitor;
  let port;

  beforeEach(() => {
    port = 3456 + Math.floor(Math.random() * 1000);
    monitor = new Monitor(port);
  });

  afterEach(async () => {
    if (monitor.server) {
      await new Promise(resolve => {
        monitor.server.close(resolve);
      });
    }
  });

  describe('start', () => {
    it('should start the server', async () => {
      await monitor.start();

      expect(monitor.server).toBeDefined();
      expect(monitor.wss).toBeDefined();
    });

    it('should serve the dashboard', async () => {
      await monitor.start();

      const response = await fetch(`http://localhost:${port}/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('Parallel Agent Monitor');
    });
  });

  describe('API endpoints', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should return state from /api/state', async () => {
      monitor.state = { test: 'data' };

      const response = await fetch(`http://localhost:${port}/api/state`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.test).toBe('data');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('config');
    });

    it('should return packages from /api/packages', async () => {
      monitor.state.packages = {
        'task1': { id: 'task1', name: 'Task 1' }
      };

      const response = await fetch(`http://localhost:${port}/api/packages`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('task1');
    });

    it('should return metrics from /api/metrics', async () => {
      // Set up packages with different statuses
      // Note: pending is calculated as total - packages.length, so we need 6 total with 5 packages
      monitor.config = { packages: ['task1', 'task2', 'task3', 'task4', 'task5', 'task6'] };
      monitor.state.packages = {
        'task1': { id: 'task1', status: 'completed', startTime: Date.now() - 1000, endTime: Date.now() },
        'task2': { id: 'task2', status: 'completed', startTime: Date.now() - 2000, endTime: Date.now() - 1000 },
        'task3': { id: 'task3', status: 'failed', startTime: Date.now() - 3000, endTime: Date.now() - 2000, error: 'test error' },
        'task4': { id: 'task4', status: 'running', startTime: Date.now() - 500 },
        'task5': { id: 'task5', status: 'pending' }
      };

      // Call updateMetrics to recalculate based on packages
      monitor.updateMetrics();

      const response = await fetch(`http://localhost:${port}/api/metrics`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.total).toBe(6);
      expect(data.completed).toBe(2);
      expect(data.failed).toBe(1);
      expect(data.running).toBe(1);
      expect(data.pending).toBe(1); // 6 total - 5 packages = 1 pending
    });
  });

  describe('WebSocket', () => {
    beforeEach(async () => {
      await monitor.start();
    });

    it('should accept WebSocket connections', async () => {
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('should broadcast updates to clients', async () => {
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise(resolve => ws.on('open', resolve));

      const messagePromise = new Promise(resolve => {
        ws.on('message', data => {
          const message = JSON.parse(data);
          resolve(message);
        });
      });

      monitor.broadcast({
        type: 'test',
        data: { foo: 'bar' }
      });

      const message = await messagePromise;
      expect(message.type).toBe('test');
      expect(message.data.foo).toBe('bar');

      ws.close();
    });
  });

  describe('updatePackage', () => {
    it('should update package status', () => {
      monitor.packages = [
        { id: 'task1', status: 'pending' }
      ];

      monitor.updatePackage('task1', { status: 'running' });

      expect(monitor.packages[0].status).toBe('running');
    });

    it('should broadcast package updates', () => {
      monitor.packages = [
        { id: 'task1', status: 'pending' }
      ];

      const broadcastSpy = vi.spyOn(monitor, 'broadcast');

      monitor.updatePackage('task1', { status: 'completed' });

      expect(broadcastSpy).toHaveBeenCalledWith({
        type: 'package_update',
        package: expect.objectContaining({
          id: 'task1',
          status: 'completed'
        })
      });
    });
  });
});
