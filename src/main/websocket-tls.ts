/**
 * WebSocket TLS Certificate Management
 *
 * Generates and manages a self-signed TLS certificate for the WSS server.
 * Certificates are stored in the Electron userData directory and reused
 * across restarts. Provides SHA-256 fingerprint for certificate pinning.
 */

import crypto, { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { generate as generateCert } from 'selfsigned';
import { Logger } from '../shared/logger';

const logger = new Logger('WebSocketTLS');

const CERT_FILENAME = 'ws-cert.pem';
const KEY_FILENAME = 'ws-key.pem';

/** Validity period: 10 years from now. */
const VALIDITY_YEARS = 10;

export interface TlsCertificate {
  cert: string;
  key: string;
  fingerprint256: string;
}

let cachedCert: TlsCertificate | null = null;

/**
 * Get the directory where TLS certificates are stored.
 */
function getCertDir(): string {
  return app.getPath('userData');
}

/**
 * Compute the SHA-256 fingerprint of a PEM certificate.
 * Returns a colon-separated hex string (e.g. "AB:CD:EF:...").
 */
function computeFingerprint(certPem: string): string {
  // Extract DER from PEM
  const lines = certPem.split('\n').filter(
    (l) => !l.startsWith('-----') && l.trim().length > 0,
  );
  const der = Buffer.from(lines.join(''), 'base64');
  const hash = createHash('sha256').update(der).digest('hex').toUpperCase();
  // Format as colon-separated pairs
  return hash.match(/.{2}/g)!.join(':');
}

/**
 * Check whether an existing certificate is still valid (not expired).
 */
function isCertValid(certPem: string): boolean {
  try {
    // Use Node.js built-in X509Certificate (available since Node 15)
    const { X509Certificate } = crypto;
    const x509 = new X509Certificate(certPem);
    const now = new Date();
    return now >= new Date(x509.validFrom) && now <= new Date(x509.validTo);
  } catch (error) {
    // Can't parse — treat as invalid so it gets regenerated.
    // A corrupted or unparseable cert should not be trusted.
    logger.warn('Could not validate TLS certificate expiry, treating as invalid for regeneration', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Try to load an existing certificate from disk.
 * Returns null if files don't exist or cert is expired.
 */
function loadExistingCert(): TlsCertificate | null {
  const certDir = getCertDir();
  const certPath = path.join(certDir, CERT_FILENAME);
  const keyPath = path.join(certDir, KEY_FILENAME);

  const certExists = existsSync(certPath);
  const keyExists = existsSync(keyPath);
  logger.info('Looking for existing TLS certificate', {
    certPath,
    keyPath,
    certExists,
    keyExists,
  });

  if (!certExists || !keyExists) {
    logger.info('No existing TLS certificate files found');
    return null;
  }

  try {
    const cert = readFileSync(certPath, 'utf-8');
    const key = readFileSync(keyPath, 'utf-8');

    if (!isCertValid(cert)) {
      logger.info('Existing TLS certificate has expired, will regenerate');
      return null;
    }

    const fingerprint256 = computeFingerprint(cert);
    logger.info('Loaded existing TLS certificate', { fingerprint256 });
    return { cert, key, fingerprint256 };
  } catch (error) {
    logger.warn('Failed to load existing TLS certificate', { error });
    return null;
  }
}

/**
 * Generate a new self-signed TLS certificate and persist it to disk.
 */
async function generateNewCert(): Promise<TlsCertificate> {
  const now = new Date();
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + VALIDITY_YEARS);

  // Collect all local IPv4 addresses for SAN (including Tailscale, LAN, etc.)
  const altNames: Array<{ type: 1 | 2 | 6 | 7; value?: string; ip?: string }> = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '::1' },
  ];

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    // Skip known virtual/container interfaces
    if (/^(vmnet|bridge|veth|docker|br-)/.test(name)) continue;
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Avoid duplicates
        if (!altNames.some((a) => a.ip === iface.address)) {
          altNames.push({ type: 7, ip: iface.address });
        }
      }
    }
  }

  logger.info('Generating new self-signed TLS certificate', {
    validUntil: notAfter.toISOString(),
    altNames: altNames.map((a) => a.ip || a.value),
  });

  const pems = await generateCert(
    [{ name: 'commonName', value: 'Intent Local' }],
    {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate: now,
      notAfterDate: notAfter,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        {
          name: 'subjectAltName',
          altNames,
        },
      ],
    },
  );

  // Persist to disk
  const certDir = getCertDir();
  if (!existsSync(certDir)) {
    mkdirSync(certDir, { recursive: true });
  }

  const certPath = path.join(certDir, CERT_FILENAME);
  const keyPath = path.join(certDir, KEY_FILENAME);
  writeFileSync(certPath, pems.cert, { mode: 0o644 });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });

  const fingerprint256 = computeFingerprint(pems.cert);
  logger.info('Generated new TLS certificate', { fingerprint256 });

  return { cert: pems.cert, key: pems.private, fingerprint256 };
}

/**
 * Ensure a TLS certificate is available. Loads from disk if valid,
 * otherwise generates a new one. Result is cached in memory.
 */
export async function ensureTlsCertificate(): Promise<TlsCertificate> {
  if (cachedCert) {
    return cachedCert;
  }

  cachedCert = loadExistingCert();
  if (cachedCert) {
    return cachedCert;
  }

  cachedCert = await generateNewCert();
  return cachedCert;
}

/**
 * Get the SHA-256 fingerprint of the current TLS certificate.
 * Returns null if no certificate has been loaded/generated yet.
 */
export function getCertFingerprint(): string | null {
  return cachedCert?.fingerprint256 ?? null;
}

