import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { defaultSocketPath } from '../../backend/main/backend-connection';
import { parseIntentWebOptions } from './intent-web-options';
import { loadWebConfig, readLinkEpoch, resetWebKey, startLinkEpoch } from './intent-web-config';
import { findWebTailcat, checkTailcatVersion } from './intent-web-tailcat';
import { createIntentWebServer } from './intent-web-server';
import { mintLinkToken } from '../../browser-access/main/device-login';
import { LINK_PATH } from '../../browser-access/main/browser-access-server';

export async function runIntentWeb(
  args: string[],
  dependencies: {
    log?: (message: string) => void;
    webRoot?: string;
    pinnedTailcatVersion?: string;
  } = {},
) {
  const log = dependencies.log ?? console.log;
  const options = parseIntentWebOptions(args);
  if (options.help) {
    log(
      'intent-web [serve | key [--reset] | link [--url <origin>] [--ttl <minutes>]] [--port <n> | --socket <path>] [--data-dir <dir>] [--tailcat <path>] [--local-socket <path> | --no-local]',
    );
    return;
  }
  const config = loadWebConfig(options.dataDir, options.portExplicit ? options.port : undefined);
  if (options.command === 'key') {
    log(options.reset ? resetWebKey(options.dataDir) : config.accessKey);
    return;
  }
  if (options.command === 'link') {
    const epoch = readLinkEpoch(options.dataDir);
    if (!epoch)
      throw new Error(
        'No running intent-web server found; start it first with the same --data-dir (each start cancels earlier links).',
      );
    const { token, expiresAt } = mintLinkToken(config.accessKey, epoch, options.ttlMinutes);
    const origin = options.publicUrl ?? `http://127.0.0.1:${config.port}`;
    const url = `${origin}${LINK_PATH}?t=${token}`;
    log(
      `One-time sign-in link (signs in one browser, expires at ${new Date(expiresAt).toLocaleTimeString()}; restarting the server cancels it):`,
    );
    log(url);
    log(await QRCode.toString(url, { type: 'terminal', small: true }));
    if (!options.publicUrl)
      log(
        'This link uses the loopback address. Pass --url <your https address> (or set INTENT_WEB_PUBLIC_URL) to open it from another device.',
      );
    return;
  }
  const webRoot = dependencies.webRoot ?? path.resolve('dist/web');
  if (!fs.existsSync(path.join(webRoot, 'index.html')))
    throw new Error('Web build missing; run pnpm build:web first.');
  const binary = findWebTailcat(options.tailcat);
  if (binary) await checkTailcatVersion(binary, dependencies.pinnedTailcatVersion ?? '0.4.0', log);
  else if (options.tailcat)
    log(`tailcat not found or not executable at ${options.tailcat}; tunnel routes are off.`);
  else log('Tunnel routes need tailcat: set TAILCAT_BIN or put tailcat on PATH.');
  const candidate = options.localSocket ?? defaultSocketPath();
  const localSocket =
    options.local && (options.localSocket || fs.existsSync(candidate)) ? candidate : null;
  let accessKey = config.accessKey;
  const server = await createIntentWebServer({
    dataDir: options.dataDir,
    linkEpoch: startLinkEpoch(options.dataDir),
    webRoot,
    getAccessKey: () => accessKey,
    localSocket,
    tailcatAvailable: !!binary,
    tailcatBinary: binary,
  });
  // Watch the directory because key reset atomically replaces config.json.
  const watcher = fs.watch(options.dataDir, (_event, file) => {
    if (file && String(file) !== 'config.json') return;
    try {
      const next: unknown = JSON.parse(
        fs.readFileSync(path.join(options.dataDir, 'config.json'), 'utf8'),
      ).accessKey;
      if (typeof next !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(next))
        throw new Error('Invalid access key');
      if (next !== accessKey) {
        accessKey = next;
        server.disconnectAll();
      }
    } catch {
      server.disconnectAll();
    }
  });
  try {
    if (options.socket) {
      if (!server.listenSocket) throw new Error('Unix listener unavailable');
      await server.listenSocket(options.socket);
    } else await server.listen(config.port);
  } catch (error) {
    watcher.close();
    await server.close();
    throw error;
  }
  log(`Intent Web listening on ${options.socket ?? `http://127.0.0.1:${config.port}`}`);
  log(`Data directory: ${path.resolve(options.dataDir)}`);
  log(
    config.created
      ? `Access key: ${accessKey}`
      : 'Access key unchanged; run intent-web key to show it.',
  );
  log(
    'No authentication or permissions within the app: anyone with the access key has full control and can connect this server to any host and port. Never expose this port directly; put an HTTPS front-end in front.',
  );
  const close = async () => {
    watcher.close();
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await server.close();
  };
  const shutdown = () => {
    void close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return { close, server };
}
