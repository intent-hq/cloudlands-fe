import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  LINK_DEFAULT_TTL_MINUTES,
  LINK_MAX_TTL_MINUTES,
} from '../../browser-access/main/device-login';

export interface IntentWebOptions {
  command: 'serve' | 'key' | 'link';
  port: number;
  portExplicit: boolean;
  dataDir: string;
  socket?: string;
  tailcat?: string;
  localSocket?: string;
  local: boolean;
  reset: boolean;
  help: boolean;
  /** `link`: the origin the browser opens (no trailing slash), when given. */
  publicUrl?: string;
  /** `link`: lifetime in minutes. */
  ttlMinutes: number;
}

/** An http(s) origin such as `https://box.tailnet.ts.net:8443`, without a trailing slash. */
function parseOrigin(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('--url must be an http(s) address such as https://box.example.ts.net');
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      '--url must be an http(s) address with no path, such as https://box.example.ts.net',
    );
  return url.origin;
}

export function parseIntentWebOptions(
  args: string[],
  context: { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv } = {
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
  },
): IntentWebOptions {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      port: { type: 'string' },
      socket: { type: 'string' },
      'data-dir': { type: 'string' },
      tailcat: { type: 'string' },
      'local-socket': { type: 'string' },
      'no-local': { type: 'boolean' },
      reset: { type: 'boolean' },
      url: { type: 'string' },
      ttl: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'serve';
  if (positionals.length > 1 || (command !== 'serve' && command !== 'key' && command !== 'link'))
    throw new Error('Expected serve, key or link');
  if (values.reset && command !== 'key') throw new Error('--reset requires key');
  if ((values.url !== undefined || values.ttl !== undefined) && command !== 'link')
    throw new Error('--url and --ttl require link');
  if (values.socket && context.platform === 'win32')
    throw new Error('Windows supports loopback TCP only');
  if (values.socket && values.port !== undefined) throw new Error('Choose --socket or --port');
  if (values['no-local'] && values['local-socket'])
    throw new Error('Choose --no-local or --local-socket');
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' && !value.trim()) throw new Error(`--${name} must not be empty`);
  }
  const portText = values.port ?? context.env.INTENT_WEB_PORT ?? '47120';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be between 1 and 65535');
  const ttlText = values.ttl ?? String(LINK_DEFAULT_TTL_MINUTES);
  const ttlMinutes = Number(ttlText);
  if (!/^\d+$/.test(ttlText) || ttlMinutes < 1 || ttlMinutes > LINK_MAX_TTL_MINUTES)
    throw new Error(`--ttl must be 1 to ${LINK_MAX_TTL_MINUTES} minutes`);
  const urlText =
    values.url ?? (command === 'link' ? context.env.INTENT_WEB_PUBLIC_URL : undefined);
  const publicUrl = urlText?.trim() ? parseOrigin(urlText.trim()) : undefined;
  const paths = context.platform === 'win32' ? path.win32 : path.posix;
  const stateHome =
    context.platform === 'win32'
      ? (context.env.LOCALAPPDATA ?? paths.join(context.home, 'AppData', 'Local'))
      : (context.env.XDG_STATE_HOME ?? paths.join(context.home, '.local', 'state'));
  return {
    command,
    port,
    portExplicit: values.port !== undefined || context.env.INTENT_WEB_PORT !== undefined,
    dataDir:
      values['data-dir'] ?? context.env.INTENT_WEB_DATA_DIR ?? paths.join(stateHome, 'intent-web'),
    socket: values.socket,
    tailcat: values.tailcat ?? context.env.TAILCAT_BIN,
    localSocket: values['local-socket'],
    local: !values['no-local'],
    reset: !!values.reset,
    help: !!values.help,
    publicUrl,
    ttlMinutes,
  };
}
