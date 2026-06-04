import { createRequire } from 'module';
import type { WebSocket as WebSocketType, WebSocketServer as WebSocketServerType } from 'ws';

const require = createRequire(import.meta.url);

type WebSocketConstructor = typeof WebSocketType;
type WebSocketServerConstructor = typeof WebSocketServerType;

interface ResolvedWsModule {
  WebSocket: WebSocketConstructor;
  WebSocketServer: WebSocketServerConstructor;
}

let cachedWsModule: unknown;

function loadWsModule(): unknown {
  cachedWsModule ??= require('ws');
  return cachedWsModule;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isObjectLike(value) ? value[key] : undefined;
}

function isConstructable(value: unknown): boolean {
  if (typeof value !== 'function') return false;
  try {
    Reflect.construct(Object, [], value);
    return true;
  } catch {
    return false;
  }
}

function firstConstructable<T>(candidates: unknown[]): T | undefined {
  return candidates.find(isConstructable) as T | undefined;
}

function describeValueShape(value: unknown): string {
  if (!isObjectLike(value)) return value === null ? 'null' : typeof value;

  const keys = Object.keys(value);
  const visibleKeys = keys.slice(0, 20);
  const keySummary = visibleKeys
    .map((key) => `${key}:${typeof getProperty(value, key)}`)
    .join(', ');
  const suffix = keys.length > visibleKeys.length ? ', …' : '';
  return `${typeof value}{${keySummary}${suffix}}`;
}

function describeWsModuleShape(moduleValue: unknown): string {
  const defaultValue = getProperty(moduleValue, 'default');
  return `module=${describeValueShape(moduleValue)}; default=${describeValueShape(defaultValue)}`;
}

function resolveWsModule(moduleValue: unknown): ResolvedWsModule {
  const defaultValue = getProperty(moduleValue, 'default');
  const moduleShape = describeWsModuleShape(moduleValue);

  const WebSocketServer = firstConstructable<WebSocketServerConstructor>([
    getProperty(moduleValue, 'WebSocketServer'),
    getProperty(moduleValue, 'Server'),
    getProperty(defaultValue, 'WebSocketServer'),
    getProperty(defaultValue, 'Server'),
  ]);

  if (!WebSocketServer) {
    throw new Error(`Unable to resolve ws WebSocketServer constructor; module shape: ${moduleShape}`);
  }

  const WebSocket = firstConstructable<WebSocketConstructor>([
    getProperty(moduleValue, 'WebSocket'),
    getProperty(defaultValue, 'WebSocket'),
    moduleValue,
    defaultValue,
  ]);

  if (!WebSocket) {
    throw new Error(`Unable to resolve ws WebSocket constructor; module shape: ${moduleShape}`);
  }

  return { WebSocket, WebSocketServer };
}

export function getWebSocketClass(): WebSocketConstructor {
  return resolveWsModule(loadWsModule()).WebSocket;
}

export function getWebSocketServerClass(): WebSocketServerConstructor {
  return resolveWsModule(loadWsModule()).WebSocketServer;
}

export const __resolveWsModuleForTests = resolveWsModule;