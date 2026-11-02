import { execFileSync } from 'node:child_process';
import path from 'node:path';

import {
  BRIDGE_PATH,
  MAX_MESSAGE_BYTES,
  bridgeConnection,
  computeAccept,
  isLoopbackHostname,
  isSameLoopbackOrigin,
  normalizeSocketAddress,
  probeSocket,
  rejectUpgrade,
  resolveIntentdSocketPath,
} from './intentd-ws-bridge.mjs';

export {
  BRIDGE_PATH,
  MAX_MESSAGE_BYTES,
  isLoopbackHostname,
  isSameLoopbackOrigin,
  resolveIntentdSocketPath,
} from './intentd-ws-bridge.mjs';

export const SANDBOX_HEALTH_PATH = '/__sandbox/health';

const SOCKET_CONNECT_TIMEOUT_MS = 250;
const SANDBOX_HEALTH_WAIT_MS = 1_500;

function isLoopbackPeer(socket) {
  return isLoopbackHostname(normalizeSocketAddress(socket.remoteAddress));
}

function isLoopbackRequest(request) {
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return isLoopbackHostname(hostname) && isLoopbackHostname(request.socket.localAddress);
  } catch {
    return false;
  }
}

function requestPathname(url) {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

function resolveHealthWaitMs(env = process.env) {
  const configured = env.SANDBOX_HEALTH_WAIT_MS?.trim();
  return configured && /^[0-9]+$/.test(configured) ? Number(configured) : SANDBOX_HEALTH_WAIT_MS;
}

export function resolveGitInfo(
  root,
  run = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim(),
) {
  try {
    const sha = run('rev-parse', 'HEAD');
    const branch = run('rev-parse', '--abbrev-ref', 'HEAD');
    return { sha, branch: branch === 'HEAD' ? null : branch };
  } catch {
    return { sha: 'unknown', branch: 'unknown' };
  }
}

function clientModuleGraph(server) {
  return server.environments?.client?.moduleGraph ?? server.moduleGraph;
}

function configuredEntriesAreWarm(server, moduleGraph) {
  const entries = server.config?.server?.warmup?.clientFiles ?? [];
  if (!entries.length) return true;
  if (!moduleGraph?.idToModuleMap) return false;
  const root = server.config.root;
  const files = [...moduleGraph.idToModuleMap.values()]
    .map((module) => module.file)
    .filter((file) => typeof file === 'string')
    .map((file) => file.replaceAll('\\', '/'));
  return entries.every((entry) => {
    const normalizedEntry = entry.replaceAll('\\', '/');
    const absoluteEntry = path.resolve(root, entry).replaceAll('\\', '/');
    return files.some((file) => {
      const relativeFile = path.relative(root, file).replaceAll('\\', '/');
      try {
        return (
          file === absoluteEntry ||
          relativeFile === normalizedEntry ||
          path.matchesGlob(file, absoluteEntry) ||
          path.matchesGlob(relativeFile, normalizedEntry)
        );
      } catch {
        return false;
      }
    });
  });
}

async function writeHealthResponse(request, response, server, socketPath, timeoutMs, gitInfo) {
  if (request.method !== 'GET') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET');
    response.end();
    return;
  }
  const origin = request.headers.origin;
  if (
    !isLoopbackRequest(request) ||
    (origin !== undefined && !isSameLoopbackOrigin(origin, request.headers.host))
  ) {
    response.statusCode = 403;
    response.end();
    return;
  }

  const warmupEntries = server.config?.server?.warmup?.clientFiles ?? [];
  if (warmupEntries.length) {
    let timer;
    const settled = await Promise.race([
      Promise.resolve()
        .then(() => server.waitForRequestsIdle())
        .then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs.healthWait);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!settled) {
      response.statusCode = 503;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ ok: false, warmup: 'pending', git: gitInfo() }));
      return;
    }
  }
  const moduleGraph = clientModuleGraph(server);
  const daemon = await probeSocket(socketPath, timeoutMs.socketConnect);
  const entriesWarm = configuredEntriesAreWarm(server, moduleGraph);
  const body = {
    ok: daemon.reachable && entriesWarm,
    vite: { ready: true },
    daemon: { socket: socketPath, ...daemon },
    warm: { moduleGraph: moduleGraph?.idToModuleMap?.size ?? 0, entriesWarm },
    git: gitInfo(),
  };
  response.statusCode = body.ok ? 200 : 503;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function isViteHmrUpgrade(request) {
  const protocols = String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  return protocols.includes('vite-hmr');
}

export function intentdBridgePlugin({
  socketPath = resolveIntentdSocketPath(),
  platform = process.platform,
  maxMessageBytes = MAX_MESSAGE_BYTES,
  socketConnectTimeoutMs = SOCKET_CONNECT_TIMEOUT_MS,
  healthWaitMs = resolveHealthWaitMs(),
  gitInfoResolver,
} = {}) {
  return {
    name: 'intentd-same-origin-bridge',
    apply: 'serve',
    configureServer(server) {
      if (platform === 'win32') {
        console.warn(
          '[intentd-bridge] DEV ONLY bridge disabled: Windows named pipes are unsupported',
        );
        return;
      }
      if (!server.httpServer) return;

      console.log(`[intentd-bridge] proxying ${BRIDGE_PATH} to ${socketPath}`);
      console.warn(
        '[intentd-bridge] WARNING: DEV ONLY — same-origin clients receive full daemon access',
      );

      let bridgeAvailable = true;
      server.httpServer.once('listening', () => {
        const address = server.httpServer?.address();
        const boundAddress =
          address && typeof address === 'object' ? normalizeSocketAddress(address.address) : '';
        if (!isLoopbackHostname(boundAddress)) {
          bridgeAvailable = false;
          console.warn(
            `[intentd-bridge] REFUSING bridge: dev server is bound to non-loopback address ${boundAddress || 'unknown'}`,
          );
        }
      });

      const getGitInfo =
        gitInfoResolver ?? (() => resolveGitInfo(server.config?.root ?? process.cwd()));

      server.middlewares.use((request, response, next) => {
        const pathname = requestPathname(request.url);
        if (
          (pathname === BRIDGE_PATH || pathname === SANDBOX_HEALTH_PATH) &&
          (!bridgeAvailable || !isLoopbackPeer(request.socket))
        ) {
          response.statusCode = 403;
          response.end();
          return;
        }
        if (pathname === SANDBOX_HEALTH_PATH) {
          void writeHealthResponse(
            request,
            response,
            server,
            socketPath,
            { socketConnect: socketConnectTimeoutMs, healthWait: healthWaitMs },
            getGitInfo,
          ).catch((error) => {
            console.error('[intentd-bridge] health handler failed', error);
            if (response.writableEnded) return;
            response.statusCode = 500;
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ ok: false, error: 'health handler failed' }));
          });
          return;
        }
        if (pathname !== BRIDGE_PATH) return next();
        response.statusCode = 426;
        response.setHeader('Connection', 'close');
        response.setHeader('Upgrade', 'websocket');
        response.end();
      });

      const clients = new Set();
      const onUpgrade = (request, socket, head) => {
        if (isViteHmrUpgrade(request)) return;
        if (request.url !== BRIDGE_PATH) return;
        if (!bridgeAvailable || !isLoopbackPeer(socket)) {
          return rejectUpgrade(socket, 403, 'Forbidden');
        }
        const key = request.headers['sec-websocket-key'];
        if (
          request.method !== 'GET' ||
          String(request.headers.upgrade || '').toLowerCase() !== 'websocket' ||
          typeof key !== 'string' ||
          request.headers['sec-websocket-version'] !== '13'
        ) {
          return rejectUpgrade(socket, 400, 'Bad Request');
        }
        if (!isSameLoopbackOrigin(request.headers.origin, request.headers.host)) {
          return rejectUpgrade(socket, 403, 'Forbidden');
        }
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${computeAccept(key)}\r\n\r\n`,
        );
        clients.add(socket);
        socket.once('close', () => clients.delete(socket));
        bridgeConnection(socket, head, socketPath, maxMessageBytes);
      };

      server.httpServer.prependListener('upgrade', onUpgrade);
      server.httpServer.once('close', () => {
        server.httpServer?.removeListener('upgrade', onUpgrade);
        for (const client of clients) client.destroy();
      });
    },
  };
}
