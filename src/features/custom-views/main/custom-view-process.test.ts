// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CustomViewsService } from './custom-views.service';
import {
  customViewEnvironment,
  isCustomViewPortAvailable,
  probeCustomView,
} from './custom-view-process';

describe('custom view native process boundary', () => {
  let directory: string;
  let service: CustomViewsService;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'custom-view-process-'));
    service = new CustomViewsService(path.join(directory, 'views.json'), {
      startupTimeoutMs: 5000,
      pollIntervalMs: 20,
    });
  });
  afterEach(async () => {
    await service.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('removes Electron and injected Node flags, retaining the executable path and configured port', () => {
    const env = customViewEnvironment(45123, {
      PATH: '/custom/bin',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_EXTRA_LAUNCH_ARGS: '--inspect',
      NODE_OPTIONS: '--require tracer',
      NODE_PATH: '/injected',
      VSCODE_INSPECTOR_OPTIONS: 'inspect',
      PORT: '3',
    });
    expect(env).toEqual({ PATH: '/custom/bin', PORT: '45123', HOST: '127.0.0.1' });
  });

  it('rejects occupied HTTP ports and probes without following redirects', async () => {
    const server = createHttpServer((_request, response) => {
      response.writeHead(302, { Location: 'https://example.com/' });
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      expect(await isCustomViewPortAvailable(address.port)).toBe(false);
      expect(
        await probeCustomView(`http://127.0.0.1:${address.port}/`, new AbortController().signal),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await isCustomViewPortAvailable(address.port)).toBe(true);
  });

  it('cancels a readiness probe even when the server never sends HTTP headers', async () => {
    const server = createHttpServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    try {
      const abort = new AbortController();
      const probe = probeCustomView(`http://127.0.0.1:${address.port}/`, abort.signal);
      abort.abort();
      expect(await probe).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('starts a real shell child in the selected directory and kills descendants on stop', async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await fs.writeFile(
      path.join(directory, 'server.cjs'),
      `
      process.on('SIGTERM', () => {});
      require('node:http').createServer((req, res) => res.end('custom view')).listen(Number(process.env.PORT), process.env.HOST, () => console.log('view-ready', process.cwd()));
    `,
    );
    await fs.writeFile(
      path.join(directory, 'launcher.cjs'),
      `
      process.on('SIGTERM', () => {});
      require('node:child_process').spawn(process.execPath, ['server.cjs'], { stdio: 'inherit' });
    `,
    );
    const saved = await service.save({
      name: 'Native',
      directory,
      command: `${JSON.stringify(process.execPath)} launcher.cjs`,
      port: address.port,
      icon: 'terminal',
    });
    if (!saved.success) throw new Error(saved.error.message);
    const id = saved.data.views[0].id;
    await service.start({ id });
    await vi.waitFor(
      async () => {
        const result = await service.list();
        expect(result).toMatchObject({
          success: true,
          data: { runtimes: [{ status: 'running' }] },
        });
      },
      { timeout: 5000, interval: 30 },
    );
    const running = await service.list();
    if (!running.success) throw new Error(running.error.message);
    expect(running.data.runtimes[0].logs).toContain(directory);
    expect(await isCustomViewPortAvailable(address.port)).toBe(false);
    await service.stop({ id });
    await vi.waitFor(async () => expect(await isCustomViewPortAvailable(address.port)).toBe(true), {
      interval: 20,
    });
    expect(await service.list()).toMatchObject({
      success: true,
      data: { runtimes: [{ status: 'stopped' }] },
    });
  });
});
