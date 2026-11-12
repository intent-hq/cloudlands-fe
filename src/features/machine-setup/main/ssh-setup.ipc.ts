/**
 * SSH machine setup — IPC registration (main process).
 *
 * Binds the SSH setup runner to Electron IPC. The start payload carries a
 * password or passphrase, so it is validated BY HAND here: no validation
 * middleware may record or echo it. Events go only to the window that started
 * the run, and that window closing cancels the run. The captured link goes to
 * the pair-link or node-invite pipeline; only a pending id leaves main.
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { Client, utils as sshUtils } from 'ssh2';
import { Logger } from '$shared/logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type {
  MachineSetupTarget,
  SshAuth,
  SshSetupLink,
  SshSetupStartParams,
  SshSetupStartResult,
} from '$shared/types/machine-setup';
import { isNodeInviteUri } from '$shared/utils/node-invite-uri';
import { getPairLinks } from '../../backend/main/pair-link.ipc';
import { getNodeInvites } from '../../backend/main/remote-machines.ipc';
import {
  createSshSetupRunner,
  type SshSetupRunner,
  type SshSetupRunnerDeps,
} from './ssh-setup-runner';

const logger = new Logger('MachineSetupIPC');
const CHANNELS = IPC_CHANNELS.MACHINE_SETUP;

const MAX_HOST = 255;
const MAX_USER = 128;
const MAX_PATH = 4096;
const MAX_SECRET = 4096;
const MAX_RUN_ID = 64;

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseAuth(value: unknown): SshAuth | null {
  if (!record(value)) return null;
  switch (value.method) {
    case 'agent':
      return { method: 'agent' };
    case 'password':
      return isText(value.password, MAX_SECRET)
        ? { method: 'password', password: value.password }
        : null;
    case 'key': {
      if (!isText(value.keyPath, MAX_PATH) || !value.keyPath.trim()) return null;
      const { passphrase } = value;
      if (passphrase === undefined || passphrase === '')
        return { method: 'key', keyPath: value.keyPath };
      return typeof passphrase === 'string' && passphrase.length <= MAX_SECRET
        ? { method: 'key', keyPath: value.keyPath, passphrase }
        : null;
    }
    default:
      return null;
  }
}

/** Validate the start payload without ever logging or echoing it. */
export function parseStartParams(value: unknown): SshSetupStartParams | null {
  if (!record(value)) return null;
  const { host, port, username, target } = value;
  if (!isText(host, MAX_HOST) || /\s/.test(host.trim()) || host.trim().startsWith('-')) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (!isText(username, MAX_USER) || /\s/.test(username) || username.startsWith('-')) return null;
  if (target !== 'backend' && target !== 'node') return null;
  const auth = parseAuth(value.auth);
  if (!auth) return null;
  return { host: host.trim(), port, username, auth, target: target as MachineSetupTarget };
}

/** Production `holdLink`: node links go to the node-invite pipeline, the rest to pair-link. */
export async function holdSetupLink(uri: string, label: string): Promise<SshSetupLink | null> {
  if (isNodeInviteUri(uri)) {
    const held = getNodeInvites().inspect(uri);
    return held.ok
      ? { kind: 'invite', pendingId: held.pendingId, label: label || held.label || '' }
      : null;
  }
  const held = await getPairLinks().inspect(uri, { label });
  return held.ok
    ? {
        kind: 'pair',
        pendingId: held.pendingId,
        machineKind: held.kind,
        label: held.label,
        existingId: held.existingId,
      }
    : null;
}

function discardSetupLink(link: SshSetupLink): void {
  if (link.kind === 'invite') getNodeInvites().discard(link.pendingId);
  else getPairLinks().discard(link.pendingId);
}

function parseKey(data: Buffer, passphrase: string | undefined): boolean {
  return !(sshUtils.parseKey(data, passphrase) instanceof Error);
}

let runner: SshSetupRunner | null = null;
let handlersRegistered = false;
/** The window of the active run: its events go there and nowhere else. */
let owner: { runId: string; sender: WebContents; detach(): void } | null = null;

function releaseOwner(): void {
  owner?.detach();
  owner = null;
}

function getRunner(): SshSetupRunner {
  if (runner) return runner;
  const deps: SshSetupRunnerDeps = {
    createClient: () => new Client(),
    readFile: (path) => fs.readFile(path),
    homeDir: homedir(),
    env: process.env,
    platform: process.platform,
    parseKey,
    holdLink: holdSetupLink,
    discardLink: discardSetupLink,
    emit(event) {
      if (event.type === 'failed')
        logger.warn('SSH setup failed', { code: event.code, step: event.step });
      else if (event.type === 'done')
        logger.info('SSH setup done', { kind: event.result.link.kind });
      if (!owner || owner.runId !== event.runId) return;
      const { sender } = owner;
      if (event.type === 'done' || event.type === 'failed') releaseOwner();
      if (!sender.isDestroyed()) sender.send(CHANNELS.SSH_EVENT, event);
    },
  };
  runner = createSshSetupRunner(deps);
  return runner;
}

function ownsRun(event: IpcMainInvokeEvent, runId: unknown): runId is string {
  return isText(runId, MAX_RUN_ID) && owner?.runId === runId && owner.sender === event.sender;
}

export function registerSshSetupHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Validated by hand: the payload carries a password or passphrase.
  ipcMain.handle(CHANNELS.SSH_START, (event, params: unknown): SshSetupStartResult => {
    const parsed = parseStartParams(params);
    if (!parsed) throw new Error('Invalid SSH setup request');
    const result = getRunner().start(parsed);
    if (!result.ok) return result;
    const { sender } = event;
    const { runId } = result;
    const cancelOnClose = () => {
      if (owner?.runId !== runId) return;
      releaseOwner();
      getRunner().cancel(runId);
    };
    sender.once('destroyed', cancelOnClose);
    sender.once('render-process-gone', cancelOnClose);
    owner = {
      runId,
      sender,
      detach() {
        sender.off('destroyed', cancelOnClose);
        sender.off('render-process-gone', cancelOnClose);
      },
    };
    logger.info('SSH setup started', { target: parsed.target, method: parsed.auth.method });
    return result;
  });

  ipcMain.handle(CHANNELS.SSH_TRUST, (event, params: unknown) => {
    const runId = record(params) ? params.runId : undefined;
    const trusted = record(params) ? params.trusted : undefined;
    if (!ownsRun(event, runId) || typeof trusted !== 'boolean') return { ok: false };
    return { ok: getRunner().trust(runId, trusted) };
  });

  ipcMain.handle(CHANNELS.SSH_CANCEL, (event, params: unknown) => {
    const runId = record(params) ? params.runId : undefined;
    if (!ownsRun(event, runId)) return { ok: false };
    releaseOwner();
    const cancelled = getRunner().cancel(runId);
    if (cancelled) logger.info('SSH setup cancelled');
    return { ok: cancelled };
  });
}
