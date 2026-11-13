/**
 * "Set it up for me over SSH" (main process): sign in to a computer, run the
 * Intent installer with pairing on, capture the pairing link it prints and
 * hand it to the pair-link or node-invite pipeline.
 *
 * Secrets (password, passphrase, key) stay in this module for one run. The
 * link never leaves main: `holdLink` keeps it and returns a pending id. Every
 * output line is redacted before it becomes a `log` event. known_hosts is
 * read, never written.
 *
 * Every dependency is injected so the runner is testable without a network.
 */

import { randomUUID } from 'crypto';
import type {
  ConnectConfig,
  ExecOptions,
  KeyboardInteractiveCallback,
  Prompt,
  ServerHostKeyAlgorithm,
} from 'ssh2';
import type {
  SshSetupErrorCode,
  SshSetupEvent,
  SshSetupLink,
  SshSetupResult,
  SshSetupStartParams,
  SshSetupStartResult,
  SshSetupStep,
} from '$shared/types/machine-setup';
import { checkKnownHosts, hostKeyType, knownHostKeyTypes, sha256Fingerprint } from './known-hosts';
import { createLineSplitter, parseLinkMarker, parsePairUrl, redactLine } from './ssh-output';

// i18n-ignore (remote shell commands and installer wire text)
const INSTALL_SCRIPT_URL =
  'https://github.com/intent-hq/intentd-releases/releases/download/sitter-latest/install.sh';
const PROBE_COMMAND = 'uname -s; uname -n; id -un';
const LINGER_CHECK = 'loginctl show-user "$(id -un)" -p Linger';
const LINGER_ENABLE = 'sudo -n loginctl enable-linger "$(id -un)"';
const STARTING_TEXT = 'waiting for the daemon to respond';
const PAIRING_TEXT = /\bpairing\b|node mode on/i;

/** @internal */
export const SSH_SETUP_TIMEOUTS = {
  /** TCP + SSH handshake + sign-in (paused while the user decides on a host key). */
  connectMs: 20_000,
  /** The whole run. */
  overallMs: 10 * 60_000,
  /** Silence allowed while the installer downloads and installs. */
  installSilenceMs: 2 * 60_000,
  /** Silence allowed once pairing started (tunnel registration is slow). */
  pairingSilenceMs: 3 * 60_000,
  /** Log lines are batched for this long. */
  logBatchMs: 250,
} as const;

const SYSTEM_KNOWN_HOSTS = '/etc/ssh/ssh_known_hosts';
/** ssh2 host-key algorithm names for a known_hosts key type. */
const HOST_KEY_ALGORITHMS: Record<string, string[]> = {
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
};

/** A keyboard-interactive prompt that asks for the account password, not a code. */
function isPasswordPrompt(text: string): boolean {
  return /password/i.test(text) && !/one[- ]?time|otp|code|token|verification/i.test(text);
}

/** Run under sh whatever the login shell is (fish and csh reject sh syntax). */
function posixShell(command: string): string {
  return `sh -c '${command.replaceAll("'", "'\\''")}'`;
}

const MAX_LOG_BATCH = 50;
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

/** @internal */
export interface SshClientError extends Error {
  level?: string;
  code?: string;
}

/** The part of an ssh2 exec channel the runner uses. @internal */
export interface SshChannelLike {
  /** Ask the server to signal the remote command (best effort). */
  signal?(name: string): unknown;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'close', listener: (code?: number | null) => void): unknown;
  stderr: { on(event: 'data', listener: (chunk: Buffer) => void): unknown };
}

/** The part of an ssh2 `Client` the runner uses. @internal */
export interface SshClientLike {
  on(event: 'ready', listener: () => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: SshClientError) => void): unknown;
  on(
    event: 'keyboard-interactive',
    listener: (
      name: string,
      instructions: string,
      lang: string,
      prompts: Prompt[],
      finish: KeyboardInteractiveCallback,
    ) => void,
  ): unknown;
  connect(config: ConnectConfig): unknown;
  exec(
    command: string,
    options: ExecOptions,
    callback: (error: Error | undefined, channel: SshChannelLike) => void,
  ): unknown;
  end(): unknown;
}

export interface SshSetupRunnerDeps {
  createClient(): SshClientLike;
  /** Reads `~/.ssh/known_hosts` and the key file. */
  readFile(path: string): Promise<Buffer>;
  homeDir: string;
  /** `SSH_AUTH_SOCK` lives here. */
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  /** True when the private key parses (with the passphrase, if any). */
  parseKey(data: Buffer, passphrase: string | undefined): boolean;
  /** Hold the captured link; null (or a throw) means the link was rejected. */
  holdLink(uri: string, label: string): Promise<SshSetupLink | null>;
  /** Drop a held link (a run cancelled while it was being held). */
  discardLink?(link: SshSetupLink): void;
  emit(event: SshSetupEvent): void;
  newRunId?(): string;
  /** Runs the work after the start reply was sent (default `setImmediate`). */
  defer?(callback: () => void): void;
  setTimeout?(callback: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export interface SshSetupRunner {
  start(params: SshSetupStartParams): SshSetupStartResult;
  /** Answer the `host-key` question; false when no question is open. */
  trust(runId: string, trusted: boolean): boolean;
  /** Close the connection now; no event follows and nothing is held. */
  cancel(runId: string): boolean;
  activeRunId(): string | null;
}

class SetupFailure extends Error {
  constructor(
    readonly code: SshSetupErrorCode,
    readonly extra: { fingerprint?: string; os?: string } = {},
  ) {
    super(code);
  }
}

class Cancelled extends Error {}

interface Run {
  id: string;
  params: SshSetupStartParams;
  step: SshSetupStep;
  ended: boolean;
  client: SshClientLike | null;
  abort(error: Error): void;
  aborted: Promise<never>;
  timers: Set<unknown>;
  watchdog: unknown;
  connectTimer: unknown;
  pendingTrust: ((trusted: boolean) => void) | null;
  hostKeyFailure: SetupFailure | null;
  logs: string[];
  logTimer: unknown;
  /** The exec channel that is running, to stop it on cancel. */
  channel: SshChannelLike | null;
}

interface ExecResult {
  code: number | null;
  stdout: string;
}

function expandHome(path: string, homeDir: string): string {
  if (path === '~') return homeDir;
  if (path.startsWith('~/') || path.startsWith('~\\')) return `${homeDir}${path.slice(1)}`;
  return path;
}

/** @internal */
export function installCommand(target: SshSetupStartParams['target']): string {
  const mode = target === 'node' ? ' INTENTD_DAEMON_MODE=node' : '';
  return (
    `(curl -fsSL ${INSTALL_SCRIPT_URL} || wget -qO- ${INSTALL_SCRIPT_URL}) | ` +
    `INTENTD_INSTALL_SERVICE=1 INTENTD_PAIR=1 INTENTD_LINK_MARKER=1${mode} sh`
  );
}

/** Quote one word for sh. */
function shq(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** `systemctl --user` needs the session bus, which a non-login SSH shell may not name. */
const SYSTEMD_ENV = 'XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"';

/**
 * The `intentd` user unit and the binary and data dir it runs. systemd's own
 * view covers every unit path (the installer's, the .deb's) and drop-ins;
 * without a reachable user manager, read the installer's unit file instead.
 */
const DETECT_COMMAND = [
  `SHOW=$(${SYSTEMD_ENV} systemctl --user show intentd -p LoadState -p ExecStart -p Environment 2>/dev/null)`,
  'UNIT="$HOME/.config/systemd/user/intentd.service"',
  'if printf "%s\\n" "$SHOW" | grep "^LoadState=loaded" >/dev/null; then echo unit=1; ' +
    'printf "%s\\n" "$SHOW" | sed -n "s/^ExecStart=/execshow=/p; s/^Environment=/env=/p"; ' +
    'elif [ -f "$UNIT" ]; then echo unit=1; sed -n "s/^ExecStart=/exec=/p" "$UNIT" | head -n 1; ' +
    'sed -n "s/^Environment=/env=/p" "$UNIT"; fi',
].join('; ');

interface ExistingInstall {
  unit: boolean;
  execPath: string | null;
  dataDir: string | null;
}

/** Undo systemd's escaping in a unit value (`\\`, `\"`, `%%`). */
function unescapeUnit(value: string): string {
  return value.replace(/\\(["\\])/g, '$1').replaceAll('%%', '%');
}

/** The binary of an `ExecStart=` value: a quoted first word, or the first word. @internal */
export function parseExecStart(value: string): string | null {
  const rest = value.trim().replace(/^[-@+!:]+/, '');
  if (!rest) return null;
  if (rest.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
    return match ? unescapeUnit(match[1]) : null;
  }
  return unescapeUnit(rest.split(/\s+/)[0]);
}

/**
 * The words of an `Environment=` value: space-separated, a word may be
 * double-quoted with `\\"`, `\\\\` and `\\xNN` escapes (unit files and
 * `systemctl show` alike). @internal
 */
export function environmentWords(value: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < value.length) {
    while (value[i] === ' ' || value[i] === '\t') i++;
    if (i >= value.length) break;
    let word = '';
    const quoted = value[i] === '"';
    if (quoted) i++;
    while (i < value.length) {
      const c = value[i];
      if (quoted ? c === '"' : c === ' ' || c === '\t') break;
      if (c === '\\' && i + 1 < value.length) {
        const next = value[i + 1];
        if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 2, i + 4))) {
          word += String.fromCharCode(parseInt(value.slice(i + 2, i + 4), 16));
          i += 4;
          continue;
        }
        word += next;
        i += 2;
        continue;
      }
      word += c;
      i++;
    }
    if (quoted) i++;
    words.push(word.replaceAll('%%', '%'));
  }
  return words;
}

/**
 * Read the detection output: `unit=1`, then `execshow=` (systemctl's
 * `{ path=… ; argv[]=… }`) or `exec=` (the unit file's line), and `env=`
 * lines. @internal
 */
export function parseExistingInstall(stdout: string): ExistingInstall {
  const found: ExistingInstall = { unit: false, execPath: null, dataDir: null };
  for (const line of stdout.split('\n')) {
    if (line === 'unit=1') found.unit = true;
    else if (line.startsWith('execshow=')) {
      const path = /\bpath=(.*?) ; argv\[\]=/.exec(line)?.[1]?.trim();
      found.execPath = path || null;
    } else if (line.startsWith('exec=')) found.execPath = parseExecStart(line.slice(5));
    else if (line.startsWith('env=')) {
      for (const word of environmentWords(line.slice(4)))
        if (word.startsWith('INTENTD_DATA_DIR='))
          found.dataDir = word.slice('INTENTD_DATA_DIR='.length) || null;
    }
  }
  return found;
}

/** `intentd settings <key>` prints `<key> = <value>` first, then details. @internal */
export function settingEnabled(stdout: string, key: string): boolean {
  const line = stdout.split('\n').find((l) => l.startsWith(`${key} = `));
  return line?.slice(key.length + 3).trim() === 'true';
}

/** The first runnable intentd: the unit's binary, then PATH, then the installer's dirs. */
function findBinaryCommand(execPath: string | null): string {
  const candidates = [
    ...(execPath ? [shq(execPath)] : []),
    '"$(command -v intentd 2>/dev/null)"',
    '/usr/local/bin/intentd',
    '"$HOME/.local/bin/intentd"',
  ];
  return (
    `for p in ${candidates.join(' ')}; do ` +
    `if [ -n "$p" ] && [ -x "$p" ]; then printf '%s\\n' "$p"; exit 0; fi; done; exit 1`
  );
}

/** Why `intentd pair` failed on an existing install, from its output. */
function pairFailureCode(
  code: number | null,
  lines: string[],
): 'too-old' | 'orchestrator' | 'pair-failed' {
  const text = lines.join('\n');
  if (code === 2 && /unexpected argument '--(?:tunnel|node)'/.test(text)) return 'too-old';
  if (/cannot create a node invite: .*method not found/i.test(text)) return 'too-old';
  if (/runs agents only on other machines/.test(text)) return 'orchestrator';
  return 'pair-failed';
}

/** `intentd start` is unknown: a direct (non-sitter) build. */
function isMissingStart(lines: string[]): boolean {
  return /(?:unrecognized|unexpected|invalid) subcommand 'start'|unexpected argument 'start'/.test(
    lines.join('\n'),
  );
}

function fallbackPairCommand(target: SshSetupStartParams['target']): string {
  const args = target === 'node' ? 'pair --node --tunnel --yes' : 'pair --yes --tunnel';
  return [
    'INTENTD="$(command -v intentd 2>/dev/null)"',
    'if [ -z "$INTENTD" ]; then if [ -x /usr/local/bin/intentd ]; then INTENTD=/usr/local/bin/intentd; ' +
      'elif [ -x "$HOME/.local/bin/intentd" ]; then INTENTD="$HOME/.local/bin/intentd"; fi; fi',
    '[ -n "$INTENTD" ] || exit 127',
    `"$INTENTD" ${args}`,
  ].join('; ');
}

/** Map an ssh2 client error to a setup error code. @internal */
export function sshErrorCode(error: SshClientError): SshSetupErrorCode {
  if (error.level === 'client-authentication') return 'auth-refused';
  if (error.level === 'client-timeout') return 'unreachable';
  if (error.code && UNREACHABLE_CODES.has(error.code)) return 'unreachable';
  return 'failed';
}

export function createSshSetupRunner(deps: SshSetupRunnerDeps): SshSetupRunner {
  const setTimer = deps.setTimeout ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer =
    deps.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  const newRunId = deps.newRunId ?? randomUUID;
  const defer = deps.defer ?? ((callback: () => void) => void setImmediate(callback));
  let active: Run | null = null;

  // ── timers ──────────────────────────────────────────────────────────────
  function timer(run: Run, ms: number, callback: () => void): unknown {
    const handle = setTimer(() => {
      run.timers.delete(handle);
      callback();
    }, ms);
    run.timers.add(handle);
    return handle;
  }
  function clear(run: Run, handle: unknown) {
    if (handle === null || handle === undefined) return;
    run.timers.delete(handle);
    clearTimer(handle);
  }
  function armWatchdog(run: Run) {
    clear(run, run.watchdog);
    const ms =
      run.step === 'pairing'
        ? SSH_SETUP_TIMEOUTS.pairingSilenceMs
        : SSH_SETUP_TIMEOUTS.installSilenceMs;
    run.watchdog = timer(run, ms, () => run.abort(new SetupFailure('no-link')));
  }
  function stopWatchdog(run: Run) {
    clear(run, run.watchdog);
    run.watchdog = null;
  }

  // ── events ──────────────────────────────────────────────────────────────
  function flushLogs(run: Run) {
    clear(run, run.logTimer);
    run.logTimer = null;
    if (run.ended || run.logs.length === 0) return;
    const lines = run.logs;
    run.logs = [];
    deps.emit({ runId: run.id, type: 'log', lines });
  }
  function log(run: Run, line: string) {
    const safe = redactLine(line);
    if (safe === null || run.ended) return;
    run.logs.push(safe);
    if (run.logs.length >= MAX_LOG_BATCH) flushLogs(run);
    else
      run.logTimer ??= timer(run, SSH_SETUP_TIMEOUTS.logBatchMs, () => {
        run.logTimer = null;
        flushLogs(run);
      });
  }
  function setStep(run: Run, step: SshSetupStep) {
    if (run.ended || run.step === step) return;
    flushLogs(run);
    run.step = step;
    deps.emit({ runId: run.id, type: 'step', step });
  }

  function finish(run: Run) {
    run.ended = true;
    for (const handle of run.timers) clearTimer(handle);
    run.timers.clear();
    run.pendingTrust = null;
    try {
      // Without a PTY, closing the connection may leave the installer running.
      run.channel?.signal?.('KILL');
    } catch {
      // Older servers ignore signal requests.
    }
    run.channel = null;
    try {
      run.client?.end();
    } catch {
      // The connection is already gone.
    }
    run.client = null;
    if (active === run) active = null;
  }

  function guard<T>(run: Run, promise: Promise<T>): Promise<T> {
    return Promise.race([promise, run.aborted]);
  }

  // ── ssh steps ───────────────────────────────────────────────────────────
  async function authConfig(run: Run): Promise<Partial<ConnectConfig>> {
    const { auth } = run.params;
    if (auth.method === 'password') return { password: auth.password, tryKeyboard: true };
    if (auth.method === 'agent') {
      const agent = deps.platform === 'win32' ? 'pageant' : deps.env.SSH_AUTH_SOCK;
      if (!agent) throw new SetupFailure('no-agent');
      return { agent };
    }
    let key: Buffer;
    try {
      key = await deps.readFile(expandHome(auth.keyPath.trim(), deps.homeDir));
    } catch {
      throw new SetupFailure('key-unreadable');
    }
    const passphrase = auth.passphrase || undefined;
    let parses = false;
    try {
      parses = deps.parseKey(key, passphrase);
    } catch {
      parses = false;
    }
    if (!parses) throw new SetupFailure('key-unreadable');
    return { privateKey: key, ...(passphrase ? { passphrase } : {}) };
  }

  async function connect(run: Run): Promise<void> {
    const { host, port, username, auth } = run.params;
    const credentials = await guard(run, authConfig(run));
    const readText = (path: string) =>
      deps
        .readFile(path)
        .then((data) => data.toString('utf8'))
        .catch(() => '');
    const knownHosts = (
      await guard(
        run,
        Promise.all([readText(`${deps.homeDir}/.ssh/known_hosts`), readText(SYSTEM_KNOWN_HOSTS)]),
      )
    ).join('\n');
    const preferred = knownHostKeyTypes(knownHosts, host, port).flatMap(
      (type) => HOST_KEY_ALGORITHMS[type] ?? [type],
    );
    if (run.ended) throw new Cancelled();

    const client = deps.createClient();
    run.client = client;
    const startConnectTimer = () => {
      clear(run, run.connectTimer);
      run.connectTimer = timer(run, SSH_SETUP_TIMEOUTS.connectMs, () =>
        run.abort(new SetupFailure('unreachable')),
      );
    };

    const hostVerifier = (key: Buffer, verify: (valid: boolean) => void) => {
      const type = hostKeyType(key);
      const fingerprint = sha256Fingerprint(key);
      const verdict = type
        ? checkKnownHosts(knownHosts, host, port, { type, blob: key })
        : 'unknown';
      if (verdict === 'match') return verify(true);
      if (verdict === 'mismatch') {
        run.hostKeyFailure = new SetupFailure('host-key-mismatch', { fingerprint });
        return verify(false);
      }
      if (run.ended) return verify(false);
      // The user decides; the handshake clock stops meanwhile.
      clear(run, run.connectTimer);
      run.connectTimer = null;
      run.pendingTrust = (trusted) => {
        run.pendingTrust = null;
        if (!trusted) run.hostKeyFailure = new SetupFailure('host-key-declined');
        else startConnectTimer();
        verify(trusted);
      };
      deps.emit({ runId: run.id, type: 'host-key', fingerprint, algorithm: type ?? 'unknown' });
    };

    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      client.on('ready', () => {
        settled = true;
        resolve();
      });
      client.on('error', (error) => {
        const failure = run.hostKeyFailure ?? new SetupFailure(sshErrorCode(error));
        if (!settled) {
          settled = true;
          reject(failure);
        } else run.abort(new SetupFailure('failed'));
      });
      client.on('close', () => {
        if (!settled) {
          settled = true;
          reject(run.hostKeyFailure ?? new SetupFailure('unreachable'));
        } else run.abort(new SetupFailure('failed'));
      });
      if (auth.method === 'password') {
        // One round: the password answers the password prompt. A second
        // round (a one-time code) gets nothing, so the sign-in is refused
        // instead of sending the password as a code.
        let answered = false;
        client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, reply) => {
          const [prompt] = prompts;
          if (answered || prompts.length !== 1 || prompt.echo || !isPasswordPrompt(prompt.prompt))
            return reply([]);
          answered = true;
          reply([auth.password]);
        });
      }
    });
    startConnectTimer();
    client.connect({
      host,
      port,
      username,
      // Our own connect timer (paused during the host-key question) is the
      // real limit; ssh2's is a backstop.
      readyTimeout: SSH_SETUP_TIMEOUTS.overallMs,
      hostVerifier,
      // Ask for the key types known_hosts records for this host first, as
      // OpenSSH does: another type then counts as a changed key.
      ...(preferred.length
        ? {
            algorithms: {
              serverHostKey: {
                prepend: preferred as ServerHostKeyAlgorithm[],
                append: [],
                remove: [],
              },
            },
          }
        : {}),
      ...credentials,
    });
    try {
      await guard(run, ready);
    } finally {
      clear(run, run.connectTimer);
      run.connectTimer = null;
    }
  }

  function exec(run: Run, command: string, onLine?: (line: string) => void): Promise<ExecResult> {
    const client = run.client;
    if (!client || run.ended) return Promise.reject(new Cancelled());
    return guard(
      run,
      new Promise<ExecResult>((resolve, reject) => {
        client.exec(posixShell(command), { pty: false }, (error, channel) => {
          if (error) return reject(new SetupFailure('failed'));
          run.channel = channel;
          const out = createLineSplitter();
          const err = createLineSplitter();
          const stdout: string[] = [];
          const feed = (lines: string[], keep: boolean) => {
            if (keep) stdout.push(...lines);
            if (onLine) for (const line of lines) onLine(line);
          };
          channel.on('data', (chunk: Buffer) => feed(out.push(chunk), !onLine));
          channel.stderr.on('data', (chunk: Buffer) => feed(err.push(chunk), false));
          channel.on('close', (code?: number | null) => {
            if (run.channel === channel) run.channel = null;
            feed(out.flush(), !onLine);
            feed(err.flush(), false);
            resolve({ code: typeof code === 'number' ? code : null, stdout: stdout.join('\n') });
          });
        });
      }),
    );
  }

  /** Run a quiet command; failures (missing tool, no sudo) count as no output. */
  async function tryExec(run: Run, command: string): Promise<ExecResult> {
    try {
      return await exec(run, command);
    } catch (error) {
      if (error instanceof SetupFailure && error.code === 'failed')
        return { code: null, stdout: '' };
      throw error;
    }
  }

  async function lingerUser(run: Run, user: string): Promise<string | null> {
    const lingering = async () => {
      const result = await tryExec(run, LINGER_CHECK);
      return { on: /^Linger=yes\s*$/m.test(result.stdout), missing: result.code === 127 };
    };
    const first = await lingering();
    if (first.on || first.missing) return null;
    await tryExec(run, LINGER_ENABLE);
    return (await lingering()).on ? null : user || null;
  }

  async function execute(run: Run): Promise<SshSetupResult> {
    // Next tick: the start reply (the run id) reaches the renderer before
    // the first event of the run.
    await new Promise<void>((resolve) => defer(resolve));
    if (run.ended) throw new Cancelled();
    deps.emit({ runId: run.id, type: 'step', step: 'connecting' });
    await connect(run);

    const probe = await exec(run, PROBE_COMMAND);
    const [os = '', nodeName = '', user = ''] = probe.stdout.split('\n').map((s) => s.trim());
    if (os !== 'Linux')
      throw new SetupFailure('unsupported-os', { os: os.slice(0, 64) || 'unknown' });

    const detected = parseExistingInstall((await exec(run, DETECT_COMMAND)).stdout);
    const binary = (await exec(run, findBinaryCommand(detected.execPath))).stdout.trim();
    if (binary) return await useExisting(run, detected, binary, user, nodeName);

    // Installer: the step follows its output; the marker line is the link.
    setStep(run, 'installing');
    let link: string | null = null;
    let urlLink: string | null = null;
    const onInstallerLine = (line: string) => {
      armWatchdog(run);
      const marker = parseLinkMarker(line);
      if (marker) link ??= marker;
      urlLink ??= parsePairUrl(line);
      if (run.step === 'installing' && line.includes(STARTING_TEXT)) setStep(run, 'starting');
      if (run.step !== 'pairing' && PAIRING_TEXT.test(line)) {
        setStep(run, 'pairing');
        armWatchdog(run);
      }
      log(run, line);
    };
    armWatchdog(run);
    const install = await exec(run, installCommand(run.params.target), onInstallerLine);
    stopWatchdog(run);
    if (install.code !== 0) throw new SetupFailure('install-failed');

    // Older installers: no marker. Use a printed `URL:` line, else pair now.
    link ??= urlLink;
    if (!link) {
      setStep(run, 'pairing');
      armWatchdog(run);
      const pair = await exec(run, fallbackPairCommand(run.params.target), (line) => {
        armWatchdog(run);
        link ??= parsePairUrl(line) ?? parseLinkMarker(line);
        log(run, line);
      });
      stopWatchdog(run);
      if (pair.code !== 0) throw new SetupFailure('install-failed');
      if (!link) throw new SetupFailure('no-link');
    }

    const linger = await lingerUser(run, user);
    return {
      ...(await holdFor(run, link, nodeName)),
      lingerUser: linger,
      existing: false,
      remoteTurnedOn: false,
    };
  }

  /** Hand the captured link to main's pipeline. */
  async function holdFor(
    run: Run,
    link: string,
    nodeName: string,
  ): Promise<{ link: SshSetupLink }> {
    setStep(run, 'adding');
    const holding = Promise.resolve().then(() => deps.holdLink(link, nodeName));
    // A run cancelled or timed out while the link was being held keeps nothing.
    holding.then(
      (late) => {
        if (late && run.ended) deps.discardLink?.(late);
      },
      () => {},
    );
    let held: SshSetupLink | null;
    try {
      held = await guard(run, holding);
    } catch (error) {
      if (error instanceof SetupFailure || error instanceof Cancelled) throw error;
      held = null;
    }
    if (!held) throw new SetupFailure('link-rejected');
    return { link: held };
  }

  /**
   * intentd is already installed: never install, restart, upgrade or change
   * its mode. Start it only if it is stopped, then pair the running daemon.
   */
  async function useExisting(
    run: Run,
    found: ExistingInstall,
    binary: string,
    user: string,
    nodeName: string,
  ): Promise<SshSetupResult> {
    setStep(run, 'found');
    const env = found.dataDir ? `INTENTD_DATA_DIR=${shq(found.dataDir)} ` : '';
    const intentd = (args: string) => `${env}${shq(binary)} ${args}`;
    const waitUp = (seconds: number) =>
      exec(
        run,
        `i=0; while [ "$i" -lt ${seconds} ]; do ${intentd('status')} >/dev/null 2>&1 && exit 0; ` +
          `sleep 1; i=$((i+1)); done; exit 1`,
      );

    if ((await exec(run, intentd('status'))).code !== 0) {
      const active =
        found.unit &&
        (await tryExec(run, `${SYSTEMD_ENV} systemctl --user is-active intentd`)).stdout.trim() ===
          'active';
      if (!active) {
        setStep(run, 'starting');
        if (found.unit) {
          await tryExec(run, `${SYSTEMD_ENV} systemctl --user start intentd`);
        } else {
          // A daemon we could not reach (its data dir is set somewhere we
          // cannot read) must not get a fresh, empty sibling to pair instead.
          if ((await tryExec(run, 'pgrep -u "$(id -u)" -x intentd')).stdout.trim())
            throw new SetupFailure('running-elsewhere');
          const lines: string[] = [];
          const started = await exec(run, intentd('start'), (line) => {
            lines.push(line);
            log(run, line);
          });
          if (started.code !== 0 && isMissingStart(lines)) throw new SetupFailure('no-start');
        }
      }
      if ((await waitUp(60)).code !== 0) throw new SetupFailure('did-not-start');
    }

    const settings = async () => {
      const out = (
        await tryExec(
          run,
          `${intentd('settings server.wsApi.enabled')}; ${intentd('settings server.tunnel.enabled')}`,
        )
      ).stdout;
      return ['server.wsApi.enabled', 'server.tunnel.enabled'].map((key) =>
        settingEnabled(out, key),
      );
    };
    const before = await settings();

    setStep(run, 'pairing');
    armWatchdog(run);
    const raw: string[] = [];
    let link: string | null = null;
    const pair = await exec(
      run,
      intentd(run.params.target === 'node' ? 'pair --node --tunnel --yes' : 'pair --yes --tunnel'),
      (line) => {
        armWatchdog(run);
        raw.push(line);
        link ??= parsePairUrl(line);
        log(run, line);
      },
    );
    stopWatchdog(run);
    if (pair.code !== 0) throw new SetupFailure(pairFailureCode(pair.code, raw));
    raw.length = 0;
    if (!link) throw new SetupFailure('no-link');

    const after = await settings();
    const remoteTurnedOn = after.some((on, i) => on && !before[i]);
    const linger = await lingerUser(run, user);
    return {
      ...(await holdFor(run, link, nodeName)),
      lingerUser: linger,
      existing: true,
      remoteTurnedOn,
    };
  }

  function start(params: SshSetupStartParams): SshSetupStartResult {
    if (active) return { ok: false, code: 'busy' };
    let abort: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = reject;
    });
    aborted.catch(() => {});
    const run: Run = {
      id: newRunId(),
      params,
      step: 'connecting',
      ended: false,
      client: null,
      abort: (error) => abort(error),
      aborted,
      timers: new Set(),
      watchdog: null,
      connectTimer: null,
      pendingTrust: null,
      hostKeyFailure: null,
      logs: [],
      logTimer: null,
      channel: null,
    };
    active = run;
    timer(run, SSH_SETUP_TIMEOUTS.overallMs, () => run.abort(new SetupFailure('no-link')));

    void execute(run).then(
      (result) => {
        if (run.ended) {
          deps.discardLink?.(result.link);
          return;
        }
        flushLogs(run);
        deps.emit({ runId: run.id, type: 'done', result });
        finish(run);
      },
      (error: unknown) => {
        if (run.ended) return;
        flushLogs(run);
        const failure = error instanceof SetupFailure ? error : new SetupFailure('failed');
        deps.emit({
          runId: run.id,
          type: 'failed',
          code: failure.code,
          step: run.step,
          ...failure.extra,
        });
        finish(run);
      },
    );
    return { ok: true, runId: run.id };
  }

  function trust(runId: string, trusted: boolean): boolean {
    if (!active || active.id !== runId || !active.pendingTrust) return false;
    active.pendingTrust(trusted);
    return true;
  }

  function cancel(runId: string): boolean {
    const run = active;
    if (!run || run.id !== runId) return false;
    finish(run);
    run.abort(new Cancelled());
    return true;
  }

  return { start, trust, cancel, activeRunId: () => active?.id ?? null };
}
