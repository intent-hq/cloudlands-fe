// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { DockSavedMedia } from '../../../shared/dock-media-edit';

const fixture = vi.hoisted(() => ({
  root: '',
  mode: 'complete',
  session: {},
  connection: {},
  media: null as DockSavedMedia | null,
  handlers: new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<any>>(),
  observers: new Set<(...args: any[]) => void>(),
  children: new Set<ChildProcess>(),
  exports: 0,
  heldCopy: null as Promise<void> | null,
  copyEntered: (() => {}) as () => void,
  childReady: (() => {}) as () => void,
}));
vi.mock('electron', async () => {
  return {
    app: {
      isPackaged: false,
      getAppPath: () => fixture.root,
      getPath: () => `${fixture.root}/userdata`,
    },
    session: { defaultSession: fixture.session },
    BrowserWindow: { fromWebContents: (sender: any) => sender.owner },
    ipcMain: { handle: (channel: string, handler: any) => fixture.handlers.set(channel, handler) },
    nativeImage: new Proxy(
      {},
      {
        get: () => {
          throw new Error('No image operation in job lifecycle fixture');
        },
      },
    ),
  };
});
vi.mock('../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
  },
}));
vi.mock('../../backend/main/backend.ipc', () => {
  const client = {
    getRepositoryConnection: () => fixture.connection,
    getAcknowledgedHello: () => ({ server: { capabilities: {} } }),
    onRepositoryConnectionEvent: (listener: (...args: any[]) => void) => {
      fixture.observers.add(listener);
      return () => fixture.observers.delete(listener);
    },
    request: async (method: string) => {
      if (method === 'principal.me')
        return {
          id: 'principal',
          isAdministrator: true,
          login: null,
          displayName: null,
          avatarUrl: null,
        };
      if (method === 'workspace.get') return { id: 'workspace', myRole: 'owner' };
      if (method === 'agent.get') return { id: 'agent', workspaceId: 'workspace' };
      if (method === 'drafts.get')
        return {
          text: '',
          attachments: [
            {
              id: 'clip',
              attachmentId: 'attachment',
              path: fixture.media!.source.path,
              screen: { kind: 'clip', clip: { media: fixture.media } },
            },
          ],
        };
      if (method === 'file.getAttachmentInfo')
        return {
          attachmentId: 'attachment',
          path: fixture.media!.source.path,
          exists: true,
          size: 9,
        };
      throw new Error(`Unexpected fixture method: ${method}`);
    },
  };
  return { getBackendClientForId: () => client };
});
vi.mock('../../backend/main/transfer-connections', () => ({
  requestRouted: async (_client: unknown, method: string) => {
    expect(method).toBe('file.readChunk');
    fixture.copyEntered();
    await fixture.heldCopy;
    return { size: 9, bytesRead: 9, content: Buffer.from('synthetic').toString('base64') };
  },
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (binary: string, args: string[], options: any) => {
      expect(binary).toBe(`${fixture.root}/resources/dock-helper/intent-dock-media-export`);
      const child = actual.spawn(process.execPath, [binary, ...args], {
        ...options,
        env: { ...process.env, FIXTURE_MODE: fixture.mode },
      });
      fixture.children.add(child);
      child.once('close', () => fixture.children.delete(child));
      if (!args.length) {
        fixture.exports++;
        child.stdout!.on('data', (data) => {
          if (String(data).includes('fixture-ready')) fixture.childReady();
        });
      }
      return child;
    },
  };
});

import { setupChatMediaIPC } from './chat-media.ipc';
import {
  exportDockMedia,
  releaseDockMediaJob,
  type DockMediaJobContext,
} from './dock-media-output';
import { registerChatWindow } from '../../../main/chat-window-identity';
import { stampWindowWithBackend } from '../../../main/window-backend';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';

class WindowFixture extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    owner: this,
    mainFrame: { url: 'app://workspaces/workspace/workspace' },
    isDestroyed: () => false,
    getType: () => 'window',
    session: fixture.session,
  });
  isDestroyed() {
    return false;
  }
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let window: WindowFixture, event: IpcMainInvokeEvent, sessionId: string;
const C = IPC_CHANNELS.CHAT_MEDIA;
const invoke = (channel: string, value: unknown) => fixture.handlers.get(channel)!(event, value);
const control = (value: unknown, session = sessionId) =>
  invoke(C.CONTROL, { sessionId: session, control: value });
const request = (jobId: string) => ({
  outputVersion: 2 as const,
  jobId,
  media: structuredClone(fixture.media!),
  layers: [],
});
const dirs = () =>
  readdir(`${fixture.root}/userdata/dock-media-jobs`).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
const exportJob = async (jobId = randomUUID()) => {
  const result = await control({ action: 'export', request: request(jobId) });
  expect(result.ok).toBe(true);
  expect(await readFile(result.value.video.sourcePath, 'utf8')).toBe('synthetic');
  return { jobId, output: result.value.video.sourcePath as string };
};
const adopt = (jobId: string, session = sessionId) => control({ action: 'adopt', jobId }, session);
const release = (jobId: string) => control({ action: 'release', jobId });

beforeEach(async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  fixture.root = await mkdtemp(path.join(tmpdir(), 'chat-media-jobs-'));
  fixture.mode = 'complete';
  fixture.connection = {};
  fixture.exports = 0;
  fixture.heldCopy = null;
  fixture.copyEntered = () => {};
  fixture.childReady = () => {};
  fixture.media = {
    source: {
      id: 'source',
      revision: 0,
      kind: 'recording',
      attachmentId: 'attachment',
      path: '.intent/attachments/synthetic.mp4',
      durationMs: 1000,
      width: 64,
      height: 64,
      audio: 'none',
      visuals: 'clean',
      batches: [],
      capturedMarks: [],
    },
    saved: null,
    transcript: null,
  };
  await mkdir(`${fixture.root}/resources/dock-helper`, { recursive: true });
  // Controlled Node child: writes synthetic bytes only, never loads a native helper.
  await writeFile(
    `${fixture.root}/resources/dock-helper/intent-dock-media-export`,
    `
const fs = require('node:fs');
if (process.argv.includes('--capability')) {
  console.log(JSON.stringify({event:'capability', outputVersion:2, features:['blur-strokes']}));
} else {
  let input = '';
  process.stdin.on('data', data => input += data);
  process.stdin.on('end', () => {
    const job = JSON.parse(input);
    fs.copyFileSync(job.source, job.output);
    if (process.env.FIXTURE_MODE === 'held') {
      console.log(JSON.stringify({event:'progress', fraction:0.5, fixture:'fixture-ready'}));
      setInterval(() => {}, 1000);
    } else console.log(JSON.stringify({event:'complete', outputVersion:process.env.FIXTURE_MODE === 'invalid' ? 1 : 2}));
  });
}
`,
  );
  setupChatMediaIPC();
  window = new WindowFixture();
  registerChatWindow(window as unknown as BrowserWindow);
  stampWindowWithBackend(window as unknown as BrowserWindow, 'backend');
  event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent;
  const begin = await invoke(C.BEGIN, {
    workspaceId: 'workspace',
    agentId: 'agent',
    principalId: 'principal',
    draftId: randomUUID(),
    media: [fixture.media],
  });
  expect(begin).toEqual({ ok: true, value: { sessionId: expect.any(String) } });
  sessionId = begin.value.sessionId;
});
afterEach(async () => {
  try {
    await invoke(C.CLOSE, { sessionId });
    expect(await dirs()).toEqual([]);
    expect(fixture.children.size).toBe(0);
    expect(fixture.observers.size).toBe(0);
  } finally {
    for (const child of fixture.children) {
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.kill('SIGKILL');
      await closed;
    }
    await rm(fixture.root, { recursive: true, force: true });
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', platform);
  }
});

describe('actual offline media job adoption and cancellation', () => {
  it('adopts the same completed session job once and releases its output idempotently', async () => {
    const job = await exportJob();
    expect(await adopt(job.jobId)).toEqual({ ok: true, value: true });
    expect(await adopt(job.jobId)).toEqual({ ok: true, value: false });
    expect(await release(job.jobId)).toEqual({ ok: true, value: undefined });
    expect(await release(job.jobId)).toEqual({ ok: true, value: undefined });
    await expect(stat(job.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses another session and malformed offline control without consuming the valid job', async () => {
    const job = await exportJob();
    expect(await adopt(job.jobId, randomUUID())).toEqual({ ok: false, error: 'unavailable' });
    expect(await control({ action: 'adopt', jobId: job.jobId, sourcePath: job.output })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(await control({ action: 'adopt', jobId: 'not-a-uuid' })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(await adopt(job.jobId)).toEqual({ ok: true, value: true });
  });
  it('refuses missing and released jobs', async () => {
    expect(await adopt(randomUUID())).toEqual({ ok: true, value: false });
    const job = await exportJob();
    await release(job.jobId);
    expect(await adopt(job.jobId)).toEqual({ ok: true, value: false });
  });
  it('refuses a pending source-copy job and allows adoption only after completion', async () => {
    let resume!: () => void;
    fixture.heldCopy = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      fixture.copyEntered = resolve;
    });
    const jobId = randomUUID();
    const pending = control({ action: 'export', request: request(jobId) });
    await entered;
    expect(await adopt(jobId)).toEqual({ ok: true, value: false });
    resume();
    expect((await pending).ok).toBe(true);
    expect(await adopt(jobId)).toEqual({ ok: true, value: true });
  });
  it('refuses an expired job even while its original offline lease is still live', async () => {
    // Lease was created on the real clock; only the job expiry is advanced.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const job = await exportJob();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await adopt(job.jobId)).toEqual({ ok: true, value: false });
    await release(job.jobId);
    await expect(stat(job.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['binding', 'draft'] as const)(
    'refuses %s retirement and deletes completed output',
    async (kind) => {
      const job = await exportJob();
      if (kind === 'binding') stampWindowWithBackend(window as unknown as BrowserWindow, 'backend');
      else fixture.media!.source.revision++;
      expect(await adopt(job.jobId)).toEqual({ ok: false, error: 'unavailable' });
      await releaseDockMediaJob(sessionId, job.jobId);
      await expect(stat(job.output)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
  it('reserves before the first filesystem await so immediate release cannot miss the job', async () => {
    const listeners = new Set<() => void>();
    const context: DockMediaJobContext = {
      scope: {
        sessionId: randomUUID(),
        workspaceId: 'workspace',
        agentId: 'agent',
        draftId: 'draft',
      },
      backendId: 'backend',
      isCurrent: () => true,
      onDispose: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const id = randomUUID();
    const pending = exportDockMedia(context, request(id), () => {});
    await releaseDockMediaJob(context.scope.sessionId, id);
    expect((await pending).ok).toBe(false);
    expect(fixture.exports).toBe(0);
    expect(listeners.size).toBe(0);
    expect(await dirs()).toEqual([]);
  });
  it('retires a held copy without launching a child or retaining a directory', async () => {
    let resume!: () => void;
    fixture.heldCopy = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      fixture.copyEntered = resolve;
    });
    const pending = control({ action: 'export', request: request(randomUUID()) });
    await entered;
    stampWindowWithBackend(window as unknown as BrowserWindow, 'backend');
    resume();
    expect((await pending).ok).toBe(false);
    expect(fixture.exports).toBe(0);
  });
  it('release stops a real controlled child and removes its partial output', async () => {
    fixture.mode = 'held';
    const entered = new Promise<void>((resolve) => {
      fixture.childReady = resolve;
    });
    const id = randomUUID();
    const pending = control({ action: 'export', request: request(id) });
    await entered;
    expect(fixture.children.size).toBe(1);
    expect(await dirs()).toHaveLength(1);
    expect(await release(id)).toEqual({ ok: true, value: undefined });
    expect((await pending).ok).toBe(false);
    expect(await dirs()).toEqual([]);
    expect(fixture.children.size).toBe(0);
  });
  it('rejects an invalid helper completion and removes the written output', async () => {
    fixture.mode = 'invalid';
    const id = randomUUID();
    expect(await control({ action: 'export', request: request(id) })).toMatchObject({ ok: false });
    expect(await adopt(id)).toEqual({ ok: true, value: false });
    expect(await dirs()).toEqual([]);
  });
});
