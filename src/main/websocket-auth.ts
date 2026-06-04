/**
 * WebSocket API Authentication
 *
 * Handles token generation and validation
 * for the WebSocket API server.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from '../shared/logger';
import { getCertFingerprint } from './websocket-tls';
import {
  ensureWebSocketApiToken,
  getWebSocketApiToken,
  isWebSocketApiDiscoveryEnabled,
  isWebSocketApiEnabled as readWebSocketApiEnabled,
  setWebSocketApiDiscoveryEnabled,
  setWebSocketApiEnabled as writeWebSocketApiEnabled,
  setWebSocketApiToken,
} from '../features/workspace/main/app-settings.service';

const logger = new Logger('WebSocketAuth');

/**
 * Generate a new random API token (32 bytes, hex-encoded = 64 chars).
 * Stores it in electron-store and returns the token.
 */
export function generateToken(): string {
  const token = randomBytes(32).toString('hex');
  setWebSocketApiToken(token);
  logger.info('Generated new WebSocket API token');
  return token;
}

/**
 * Get the current token, creating and persisting one only because this API is
 * explicitly named as a create-on-missing operation.
 */
export function getOrCreateToken(): string {
  return ensureWebSocketApiToken(() => randomBytes(32).toString('hex'));
}

/**
 * Validate a token against the stored token.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function validateToken(candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') {
    return false;
  }

  const stored = getWebSocketApiToken();
  if (!stored) {
    return false;
  }

  // Timing-safe comparison
  if (candidate.length !== stored.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
  } catch {
    return false;
  }
}

/**
 * Check whether the WebSocket API is enabled in settings.
 */
export function isWebSocketApiEnabled(): boolean {
  return readWebSocketApiEnabled();
}

/**
 * Set the WebSocket API enabled state.
 */
export function setWebSocketApiEnabled(enabled: boolean): void {
  writeWebSocketApiEnabled(enabled);
}

/**
 * Check whether network discovery (Bonjour/mDNS) is enabled in settings.
 */
export function isDiscoveryEnabled(): boolean {
  return isWebSocketApiDiscoveryEnabled();
}

/**
 * Set the network discovery enabled state.
 */
export function setDiscoveryEnabled(enabled: boolean): void {
  setWebSocketApiDiscoveryEnabled(enabled);
}

/**
 * Extract a bearer token from an Authorization header value.
 * Expects format: "Bearer <token>"
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/**
 * Get the SHA-256 fingerprint of the WSS server's TLS certificate.
 * Returns null if the certificate hasn't been generated yet.
 * This is used during the pairing flow so clients can pin the certificate.
 */
export function getWssCertFingerprint(): string | null {
  return getCertFingerprint();
}

