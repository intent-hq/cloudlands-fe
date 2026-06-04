/**
 * WebSocket API Bonjour/mDNS Service Discovery
 *
 * Publishes the WebSocket API server on the local network via Bonjour (mDNS/DNS-SD)
 * so that mobile apps can automatically discover the running Intent instance.
 */

import type { Service } from 'bonjour-service/dist/lib/service';
import * as os from 'os';
import { Logger } from '../shared/logger';
import { getBonjourClass, type BonjourClass } from './utils/bonjour-runtime';

const logger = new Logger('WebSocketDiscovery');

let bonjour: InstanceType<BonjourClass> | null = null;
let publishedService: Service | null = null;

/**
 * Start advertising the WebSocket API server via Bonjour/mDNS.
 * Publishes a `_intent-ws._tcp` service on the local network.
 *
 * @param port - The port the WebSocket API server is listening on.
 * @param certFingerprint - Optional SHA-256 fingerprint of the TLS certificate
 *   (colon-separated hex, e.g. "AB:CD:EF:...") so clients can pin the cert.
 */
export function startDiscovery(port: number, certFingerprint?: string): void {
  stopDiscovery(); // clean up any existing
  try {
    const Bonjour = getBonjourClass();
    bonjour = new Bonjour();
    const txt: Record<string, string> = {
      version: '1',
      path: '/ws',
      hostname: os.hostname(),
    };
    if (certFingerprint) {
      txt.fp = certFingerprint;
    }
    publishedService = bonjour.publish({
      name: `Intent on ${os.hostname().replace(/\.local$/, '')}`,
      type: 'intent-ws',
      port,
      txt,
    });
    logger.info('Bonjour service published', { port, type: '_intent-ws._tcp' });
    logger.info('Bonjour TXT record', { txt });
  } catch (error) {
    logger.error('Failed to publish Bonjour service', error as Error);
  }
}

/**
 * Stop advertising the WebSocket API server via Bonjour/mDNS.
 */
export function stopDiscovery(): void {
  if (publishedService) {
    try {
      publishedService.stop?.();
    } catch {
      /* ignore */
    }
    publishedService = null;
  }
  if (bonjour) {
    try {
      bonjour.destroy();
    } catch {
      /* ignore */
    }
    bonjour = null;
  }
  logger.info('Bonjour service unpublished');
}

/**
 * Check if the Bonjour service is currently being advertised.
 */
export function isDiscoveryActive(): boolean {
  return publishedService !== null;
}

