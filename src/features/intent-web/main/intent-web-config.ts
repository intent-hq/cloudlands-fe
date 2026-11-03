import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { generateAccessKey } from '../../browser-access/main/browser-access-auth';

interface WebConfig {
  accessKey: string;
  port: number;
}

function writeConfig(dir: string, config: WebConfig): void {
  const target = path.join(dir, 'config.json');
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function loadWebConfig(
  dir: string,
  portOverride?: number,
): WebConfig & { created: boolean } {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const target = path.join(dir, 'config.json');
  let config: WebConfig;
  let created = false;
  try {
    const value: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (
      !value ||
      typeof value !== 'object' ||
      !('accessKey' in value) ||
      !('port' in value) ||
      typeof value.accessKey !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.accessKey) ||
      typeof value.port !== 'number' ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535
    ) {
      throw new Error('Invalid intent-web configuration');
    }
    config = { accessKey: value.accessKey, port: value.port };
    fs.chmodSync(target, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    config = { accessKey: generateAccessKey(), port: portOverride ?? 47120 };
    // Exclusive creation prevents two first starts from silently replacing the key.
    fs.writeFileSync(target, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
    created = true;
  }
  if (portOverride !== undefined && config.port !== portOverride) {
    config.port = portOverride;
    writeConfig(dir, config);
  }
  return { ...config, created };
}

export function resetWebKey(dir: string): string {
  const { port } = loadWebConfig(dir);
  const accessKey = generateAccessKey();
  writeConfig(dir, { port, accessKey });
  return accessKey;
}
