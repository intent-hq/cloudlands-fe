import fs from 'node:fs';
import path from 'node:path';
import { defaultSocketPath } from '../../backend/main/backend-connection';
import { parseIntentWebOptions } from './intent-web-options';
import { loadWebConfig, resetWebKey } from './intent-web-config';
import { findWebTailcat, checkTailcatVersion } from './intent-web-tailcat';
import { createIntentWebServer } from './intent-web-server';
import { createFileSignInStore } from './intent-web-sign-in-store';
import { LOGIN_PATH } from '../../browser-access/main/browser-access-server';
import {
  SIGN_IN_CODE_TTL_MS,
  createSignInCodes,
  signInLink,
} from '../../browser-access/main/browser-access-sign-in-codes';

const INTENT_WEB_USAGE = `Usage:
  intent-web [serve] [--port <n> | --socket <path>] [--data-dir <dir>] [--tailcat <path>]
                     [--local-socket <path> | --no-local]
  intent-web key [--reset] [--data-dir <dir>]
  intent-web link [--url <origin>] [--data-dir <dir>]

Commands:
  serve   Start the server (default).
  key     Show the access key; --reset replaces it and signs out every browser.
  link    Create a single-use sign-in code and link. The code works once and
          expires after 10 minutes. The link uses --url, else the address of
          the last signed-in browser; without either, enter the code on the
          sign-in page. Works while the server runs in another process.`;

export async function runIntentWeb(
  args: string[],
  dependencies: {
    log?: (message: string) => void;
    now?: () => number;
    webRoot?: string;
    pinnedTailcatVersion?: string;
  } = {},
) {
  const log = dependencies.log ?? console.log;
  const options = parseIntentWebOptions(args);
  if (options.help) {
    log(INTENT_WEB_USAGE);
    return;
  }
  const config = loadWebConfig(options.dataDir, options.portExplicit ? options.port : undefined);
  let accessKey = config.accessKey;
  const signIn = createSignInCodes({
    store: createFileSignInStore(options.dataDir),
    getAccessKey: () => accessKey,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  if (options.command === 'key') {
    if (options.reset) {
      accessKey = resetWebKey(options.dataDir);
      // The new key already invalidates every code; drop them too.
      await signIn.clear();
    }
    log(accessKey);
    return;
  }
  if (options.command === 'link') {
    const created = await signIn.create();
    const link = signInLink(options.url ?? (await signIn.pageOrigin()), LOGIN_PATH, created.code);
    const minutes = Math.round(SIGN_IN_CODE_TTL_MS / 60_000);
    log(`Sign-in code: ${created.code}`);
    if (link) log(`Sign-in link: ${link}`);
    else
      log(
        'Open Intent in your browser and enter the code on the sign-in page (pass --url <origin> to print a link).',
      );
    log(
      `Works once. Expires in ${minutes} minutes, at ${new Date(created.expiresAt).toISOString()}.`,
    );
    return { code: created.code, link, expiresAt: created.expiresAt };
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
  const server = await createIntentWebServer({
    signIn,
    dataDir: options.dataDir,
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
