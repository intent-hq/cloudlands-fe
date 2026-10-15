import { test, expect } from '@playwright/test';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { observeErrors, stableLocatorScreenshot } from '../lib/browser.mjs';

// Explicit native opt-in; --list needs no desktop and never mutates fixtures.
// Launch only on the attested task-owned Linux X11 desktop, never a user's display.
test.use({
  headless: false,
  permissions: ['clipboard-read', 'clipboard-write'],
  launchOptions: {
    executablePath: process.env.PARITY_NATIVE_CHROMIUM,
    args: ['--ozone-platform=x11', '--window-position=650,20'],
  },
});
const exec = promisify(execFile);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const browserHash = '8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e';
const xdo = async (...args) =>
  (await exec('/usr/bin/xdotool', args, { timeout: 5000 })).stdout.trim();

function ownedRead(method, params, clientId) {
  if (clientId && method !== 'drafts.get')
    throw new Error('Only the recorded prior draft scope may use a captured client identity');
  if (!['agent.getConversation', 'agent.get', 'note.list', 'drafts.get'].includes(method))
    throw new Error('Independent daemon observation is read-only');
  return new Promise((resolve, reject) => {
    const socket = connect('/owned/data/intentd.sock');
    let buffer = '',
      settled = false;
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned read timeout')));
    socket.on('error', reject);
    socket.on('end', () => {
      if (!settled) reject(new Error('Owned read ended without reply'));
    });
    socket.on('connect', () =>
      socket.write(
        JSON.stringify(
          clientId
            ? { jsonrpc: '2.0', id: 0, method: 'client.hello', params: { clientId } }
            : { jsonrpc: '2.0', id: 1, method, params },
        ) + '\n',
      ),
    );
    socket.on('data', (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const reply = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (reply.id === 0 && clientId) {
          if (reply.result?.clientId !== clientId) {
            settled = true;
            socket.destroy();
            reject(new Error('Recorded prior client identity was not admitted'));
            return;
          }
          socket.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n');
          continue;
        }
        if (reply.id !== 1) continue;
        settled = true;
        socket.end();
        if (reply.error) reject(new Error(JSON.stringify(reply.error)));
        else resolve(reply.result);
      }
    });
  });
}

async function desktop(info, name) {
  const file = info.outputPath(`${name}.png`);
  await exec('/usr/bin/import', ['-window', 'root', file], { timeout: 5000 });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

async function dragFile(page, textarea, file, info, step) {
  await page.bringToFront();
  await textarea.scrollIntoViewIfNeeded();
  await expect(textarea).toBeInViewport({ ratio: 1 });
  const box = await textarea.boundingBox();
  const browserWindow = await page.evaluate(() => ({
    x: window.screenX,
    y: window.screenY,
    border: (window.outerWidth - window.innerWidth) / 2,
    top: window.outerHeight - window.innerHeight,
  }));
  const destination = {
    x: Math.round(browserWindow.x + browserWindow.border + box.x + box.width / 2),
    y: Math.round(browserWindow.y + browserWindow.top + box.y + box.height / 2),
  };
  expect(destination.x).toBeGreaterThan(600);
  expect(destination.x).toBeLessThan(2100);
  expect(destination.y).toBeLessThan(1100);
  const config = info.outputPath(`pcmanfm-${step}`);
  await mkdir(config, { recursive: true });
  const child = spawn(
    '/usr/bin/pcmanfm',
    ['--new-win', '--role', 'connected-native-drop', path.dirname(file)],
    {
      env: { ...process.env, XDG_CONFIG_HOME: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = [];
  child.stdout.on('data', (data) => logs.push(String(data)));
  child.stderr.on('data', (data) => logs.push(String(data)));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    let id;
    await expect
      .poll(async () => {
        const found = await xdo('search', '--onlyvisible', '--pid', String(child.pid)).catch(
          () => '',
        );
        const ids = found.split('\n').filter(Boolean);
        if (ids.length === 1) id = ids[0];
        return ids.length;
      })
      .toBe(1);
    await xdo('windowmove', id, '10', '20', 'windowsize', id, '560', '700');
    await xdo('windowactivate', '--sync', id);
    await expect.poll(() => xdo('getwindowname', id)).toBe(path.basename(path.dirname(file)));
    const sourceWindow = Object.fromEntries(
      (await xdo('getwindowgeometry', '--shell', id))
        .split('\n')
        .map((line) => line.split('='))
        .map(([k, v]) => [k, Number(v)]),
    );
    expect(sourceWindow.WIDTH).toBe(560);
    expect(sourceWindow.HEIGHT).toBe(700);
    // Pinned PCManFM icon view. Wrong geometry must fail real native delivery.
    const source = { x: sourceWindow.X + 202, y: sourceWindow.Y + 95 };
    await xdo('key', 'ctrl+a');
    await xdo('mousemove', '--sync', String(source.x), String(source.y));
    await desktop(info, `${step}-source-selected`);
    const start = await page.evaluate(() => window.nativeAttachmentObservation.events.length);
    await xdo('mousedown', '1');
    await xdo('mousemove', '--sync', String(source.x + 50), String(source.y + 50));
    await xdo('mousemove', '--sync', String(destination.x), String(destination.y));
    const overs = () =>
      page.evaluate(
        (index) =>
          window.nativeAttachmentObservation.events
            .slice(index)
            .filter((e) => e.type === 'dragover').length,
        start,
      );
    await expect.poll(overs).toBeGreaterThan(0);
    const first = await overs();
    await xdo('mousemove', '--sync', String(destination.x + 2), String(destination.y + 2));
    await expect.poll(overs).toBeGreaterThan(first);
    await xdo('mouseup', '1');
    await expect
      .poll(() =>
        page.evaluate(
          (index) =>
            window.nativeAttachmentObservation.events
              .slice(index)
              .filter(
                (e) => e.type === 'drop' && e.files.length === 1 && e.files.every((f) => f.sha256),
              ).length,
          start,
        ),
      )
      .toBe(1);
    const events = await page.evaluate(
      (index) => window.nativeAttachmentObservation.events.slice(index),
      start,
    );
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const event = events.find((e) => e.type === type);
      expect(event?.trusted).toBe(true);
      expect(event?.types).toContain('Files');
    }
    const fileEvent = events.find((e) => e.type === 'drop');
    const metadata = await stat(file),
      bytes = await readFile(file);
    expect(fileEvent.files).toEqual([
      {
        name: path.basename(file),
        type: 'text/plain',
        size: bytes.length,
        lastModified: Math.trunc(metadata.mtimeMs),
        isFile: true,
        sha256: sha256(bytes),
        data: bytes.toString('base64'),
      },
    ]);
    await info.attach(`${step}-native-delivery`, {
      body: JSON.stringify({ source, sourceWindow, destination, browserWindow, events }),
      contentType: 'application/json',
    });
    return fileEvent.files[0];
  } finally {
    await xdo('mouseup', '1');
    child.kill('SIGKILL');
    await exited;
    await info.attach(`${step}-file-manager-log`, {
      body: logs.join(''),
      contentType: 'text/plain',
    });
  }
}

for (const width of [1280, 420]) {
  test(`native clipboard PNG and external OS file drop survive draft recovery and explicit Send at ${width}`, async ({
    page,
    browser,
    context,
  }, info) => {
    test.setTimeout(240000);
    const base = process.env.REACT_BASE_URL,
      fixtureRoot = process.env.OWNED_NATIVE_ATTACHMENT_FIXTURES;
    if (
      !base ||
      !fixtureRoot ||
      !process.env.DISPLAY ||
      !process.env.PARITY_NATIVE_CHROMIUM ||
      process.env.OWNED_NATIVE_ATTACHMENT_SEND !== 'owned-test-daemon'
    )
      throw new Error(
        'Requires task-owned X11 desktop, attested daemon, fixtures, pinned Chromium and explicit Send opt-in',
      );
    expect(new URL(base).hostname).toBe('127.0.0.1');
    expect(new URL(base).port).not.toBe('5411');
    const fixtures = JSON.parse(await readFile(path.join(fixtureRoot, 'fixtures.json'), 'utf8'));
    const f = fixtures.find((entry) => entry.width === width);
    expect(fixtures.map((entry) => entry.width)).toEqual([1280, 420]);
    const proof = JSON.parse(await readFile(path.join(fixtureRoot, 'peer.json'), 'utf8'));
    expect(proof.passed).toBe(true);
    expect(proof.peerPid).toBe(f.peerPid);
    expect(proof.socket).toBe(f.hostSocket);
    expect(proof.uid).toBe(1000);
    expect(proof.gid).toBe(1000);
    if (
      Date.parse(proof.expiresAt) < Date.now() + 300000 ||
      Date.parse(proof.at) < Date.now() - 300000
    )
      throw new Error(
        'A fresh host peer preflight and at least five minutes of daemon lease are required',
      );
    expect(process.getuid()).toBe(1000);
    expect(browser.version()).toBe('153.0.8010.12');
    expect(sha256(await readFile(process.env.PARITY_NATIVE_CHROMIUM))).toBe(browserHash);
    const versions = (
      await exec('/usr/bin/dpkg-query', [
        '-W',
        '-f=${Package}=${Version}\n',
        'openbox',
        'pcmanfm',
        'xdotool',
      ])
    ).stdout;
    for (const version of [
      'openbox=3.6.1-12build5',
      'pcmanfm=1.3.2-4build2',
      'xdotool=1:3.20160805.1-5build1',
    ])
      expect(versions).toContain(version);
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'files.json'), 'utf8'));
    const originalPng = await readFile(manifest.png.path),
      originalDrop = await readFile(manifest.drop.path);
    expect(sha256(originalPng)).toBe(manifest.png.sha256);
    expect(sha256(originalDrop)).toBe(manifest.drop.sha256);
    const rgba = async (file) =>
      (
        await exec('/usr/bin/convert', [file, '-depth', '8', 'RGBA:-'], {
          encoding: 'buffer',
          maxBuffer: 1024 * 1024,
        })
      ).stdout;
    const decodedOriginal = await rgba(manifest.png.path);
    expect(sha256(decodedOriginal)).toBe(manifest.png.rgbaSha256);
    const { workspaceId, agentId } = f;
    const independent = (method) => ownedRead(method, { workspaceId, agentId });
    let initialDraft, currentClientId;
    const priorScopeManifest = process.env.OWNED_NATIVE_ATTACHMENT_PRIOR_SCOPE
      ? JSON.parse(await readFile(process.env.OWNED_NATIVE_ATTACHMENT_PRIOR_SCOPE, 'utf8'))
      : undefined;
    const priorScope = priorScopeManifest?.fixtures.find((entry) => entry.width === width);
    if (priorScope) {
      expect(priorScope.workspaceId).toBe(workspaceId);
      expect(priorScope.agentId).toBe(agentId);
      const priorDraft = await ownedRead(
        'drafts.get',
        { workspaceId, agentId },
        priorScope.clientId,
      );
      expect(priorDraft.text).toBe(priorScope.draft.text);
      expect(priorDraft.attachments).toEqual(priorScope.draft.attachments);
      expect(sha256(await readFile(priorScopeManifest.sourceReceipt))).toBe(
        priorScopeManifest.sourceReceiptSha256,
      );
    }
    const priorScopeEvidence = [];
    const beforeHistory = await independent('agent.getConversation');
    expect(beforeHistory.messages).toEqual([]);
    expect(beforeHistory.turnInFlight).toBe(false);
    expect((await independent('agent.get')).agent.provider).toBe(f.provider);
    const git = async (...args) =>
      (await exec('/usr/bin/git', ['-C', f.repositoryPath, ...args])).stdout.trim();
    const repositoryFiles = async (relative = '') => {
      const files = {};
      for (const entry of await readdir(path.join(f.repositoryPath, relative), {
        withFileTypes: true,
      })) {
        if (!relative && entry.name === '.git') continue;
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) Object.assign(files, await repositoryFiles(name));
        else {
          expect(entry.isFile(), `Unexpected repository entry: ${name}`).toBe(true);
          files[name] = sha256(await readFile(path.join(f.repositoryPath, name)));
        }
      }
      return files;
    };
    const repoSnapshot = async () => ({
      head: await git('rev-parse', 'HEAD'),
      index: await git('ls-files', '--stage'),
      status: await git('status', '--porcelain', '--untracked-files=all'),
      files: await repositoryFiles(),
    });
    // Attachment placement intentionally creates its local storage and two ignore
    // markers. Enumerate every file, including ignored files, and admit only the
    // exact registered bytes. Tracked files, HEAD and index remain unchanged.
    const expectedRepo = (registrations) => ({
      head: f.baseSha,
      index: f.index,
      status: registrations.length ? '?? .intent/.gitignore' : '',
      files: {
        ...f.files,
        ...(registrations.length
          ? {
              '.intent/.gitignore':
                'f069f6c63e85d215a92356c7f4364f0b5f6f8121642af11e2f4b9e7a4ba80b5d',
              '.intent/attachments/.gitignore':
                'cdbcae15105d6b781e620813c79c7e868740d4e9cc53ce6f5fcbbc12387adf4b',
            }
          : {}),
        ...Object.fromEntries(registrations.map((item) => [item.path, item.sha256])),
      },
    });
    const beforeRepo = await repoSnapshot();
    expect(beforeRepo).toEqual(expectedRepo(priorScope?.registered ?? []));
    expect(await ownedRead('note.list', { workspaceId })).toEqual(f.notesBefore);
    const errors = await observeErrors(page),
      requests = [],
      replies = [],
      pushes = [],
      geometry = [],
      registry = [],
      delivered = [],
      sockets = [];
    let history, user, assistant, afterRepo, afterNotes;
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== '/intentd/ws') return;
      const state = { url: socket.url(), closed: false, requests: [], subscriptions: [] };
      sockets.push(state);
      const pending = new Map();
      socket.on('close', () => {
        state.closed = true;
      });
      socket.on('framesent', ({ payload }) => {
        const request = JSON.parse(String(payload));
        requests.push(request);
        state.requests.push(request);
        pending.set(request.id, request);
      });
      socket.on('framereceived', ({ payload }) => {
        const response = JSON.parse(String(payload)),
          request = pending.get(response.id);
        if (response.method === 'subscription.push') pushes.push(response.params);
        if (request) {
          pending.delete(response.id);
          replies.push({ request, response });
          if (request.method === 'chat.subscribe' && response.result?.subscriptionId)
            state.subscriptions.push(response.result.subscriptionId);
        }
      });
    });
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(5000);
      const observation = {
        events: [],
        types: ['paste', 'dragenter', 'dragover', 'drop', 'keydown', 'click'],
      };
      observation.listener = (event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest('[data-testid=conversation-composer]')
        )
          return;
        const transfer = event.clipboardData ?? event.dataTransfer;
        const files = Array.from(transfer?.files ?? []);
        const record = {
          type: event.type,
          key: event.key,
          ctrlKey: event.ctrlKey,
          trusted: event.isTrusted,
          types: Array.from(transfer?.types ?? []),
          files: [],
        };
        observation.events.push(record);
        for (const file of files) {
          const result = {
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            isFile: file instanceof window.File,
          };
          record.files.push(result);
          file
            .arrayBuffer()
            .then(async (data) => {
              result.data = window.btoa(String.fromCharCode(...new Uint8Array(data)));
              result.sha256 = Array.from(
                new Uint8Array(await window.crypto.subtle.digest('SHA-256', data)),
                (byte) => byte.toString(16).padStart(2, '0'),
              ).join('');
            })
            .catch((error) => {
              result.error = String(error);
            });
        }
      };
      for (const type of observation.types)
        window.addEventListener(type, observation.listener, true);
      observation.remove = () => {
        for (const type of observation.types)
          window.removeEventListener(type, observation.listener, true);
      };
      window.addEventListener('pagehide', observation.remove, { once: true });
      window.nativeAttachmentObservation = observation;
    });
    const inputRecords = [];
    const captureInputs = async () =>
      inputRecords.push(...(await page.evaluate(() => window.nativeAttachmentObservation.events)));
    const rpc = (method, params) =>
      page.evaluate(
        async ({ method, params }) => {
          if (!['file.getAttachmentInfo', 'file.readChunk', 'drafts.get'].includes(method))
            throw new Error('Browser proof RPC is read-only');
          const module = performance
            .getEntriesByType('resource')
            .find((entry) =>
              new URL(entry.name).pathname.endsWith('/features/backend/backend-transport.ts'),
            );
          if (!module) throw new Error('Canonical React backend transport missing');
          const { backendRequest } = await import(module.name);
          return backendRequest(method, params);
        },
        { method, params },
      );
    const getDraft = () => rpc('drafts.get', { workspaceId, agentId });
    const composer = page.getByTestId('conversation-composer'),
      textarea = composer.locator('textarea'),
      chips = composer.getByTestId('composer-attachments');
    const placed = () =>
      replies.filter(
        ({ request, response }) =>
          request.method === 'file.placeAttachment' && response.result?.attachmentId,
      );
    const placements = () =>
      requests.filter((request) => request.method === 'file.placeAttachment');
    const sends = () => requests.filter((request) => request.method === 'agent.sendMessage');
    const ready = async () => {
      await expect(page.getByTestId('workspace-conversation')).toHaveAttribute(
        'data-ready',
        'true',
        { timeout: 30000 },
      );
      await expect(textarea).toBeEnabled({ timeout: 15000 });
      await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    };
    // Keep the whole connected conversation in frame. In pinned headed Chromium,
    // a tight composer crop alternates antialiasing on its context-button edges;
    // the enclosing conversation preserves the pixels and passes the same exact
    // two-frame/context guard. No style injection, masking or tolerance is used.
    const capture = async (name, target = page.getByTestId('workspace-conversation')) => {
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await expect
        .poll(
          () =>
            target.evaluate(
              (node) =>
                node
                  .getAnimations({ subtree: true })
                  .filter((animation) => animation.playState === 'running').length,
            ),
          { message: 'Product animations must settle before strict capture' },
        )
        .toBe(0);
      const box = await target.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      geometry.push({ name, width, box, composer: await composer.boundingBox() });
      const screenshot = info.outputPath(`${name}-${width}.png`);
      const attempts = [];
      let lastPng;
      try {
        await writeFile(
          screenshot,
          await stableLocatorScreenshot(page, target, async ({ png, ...attempt }) => {
            if (png) {
              lastPng = png;
              await writeFile(
                info.outputPath(`${name}-attempt-${attempt.attempt}-${width}.png`),
                png,
              );
            }
            attempts.push(attempt);
          }),
        );
      } catch (error) {
        if (lastPng) await writeFile(info.outputPath(`${name}-unstable-${width}.png`), lastPng);
        throw error;
      } finally {
        await writeFile(
          info.outputPath(`${name}-capture-${width}.json`),
          JSON.stringify(attempts, null, 2),
        );
      }
      await info.attach(name, { path: screenshot, contentType: 'image/png' });
    };
    const register = async (file, count) => {
      await expect.poll(() => placed().length).toBe(count);
      expect(placements()).toHaveLength(count);
      const { request, response } = placed().at(-1);
      expect(request.params).toMatchObject({
        workspaceId,
        fileName: file.name,
        mimeType: file.type,
      });
      expect(request.params.idempotencyKey).toBeTruthy();
      const bytes = Buffer.from(file.data, 'base64');
      expect(Buffer.from(request.params.data, 'base64')).toEqual(bytes);
      expect(sha256(bytes)).toBe(file.sha256);
      const meta = await rpc('file.getAttachmentInfo', {
        workspaceId,
        attachmentId: response.result.attachmentId,
      });
      expect(meta).toMatchObject({
        attachmentId: response.result.attachmentId,
        fileName: response.result.fileName,
        size: bytes.length,
        exists: true,
      });
      expect(meta.path).toMatch(/^\.intent\/attachments\//);
      const saved = await rpc('file.readChunk', {
        workspaceId,
        path: meta.path,
        offset: 0,
        length: 65536,
      });
      expect(saved.bytesRead).toBe(bytes.length);
      expect(Buffer.from(saved.content, 'base64')).toEqual(bytes);
      const record = { ...meta, original: file, sha256: sha256(bytes) };
      registry.push(record);
      delivered.push(file);
      expect(sends()).toHaveLength(0);
      return record;
    };
    const waitDraft = async (ids, start = 0) => {
      await expect
        .poll(() =>
          replies
            .slice(start)
            .some(
              ({ request, response }) =>
                request.method === 'drafts.set' &&
                response.result?.ok &&
                JSON.stringify((request.params.attachments ?? []).map((a) => a.attachmentId)) ===
                  JSON.stringify(ids),
            ),
        )
        .toBe(true);
      const draft = await getDraft();
      expect((draft?.attachments ?? []).map((a) => a.attachmentId)).toEqual(ids);
    };
    const token = `NATIVE_ATTACHMENTS_${width}_${info.testId.replace(/[^a-zA-Z0-9]/g, '')}`;
    const prompt = `These are safe test attachments. Reply exactly ${token}. Do not use tools, run commands, read other files, delegate, or change any state.`;
    let primaryError, cleanupError;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/workspaces/${workspaceId}?agent=${agentId}`);
      await ready();
      initialDraft = await getDraft();
      expect(initialDraft).toBeNull();
      currentClientId = replies
        .filter(
          ({ request, response }) => request.method === 'client.hello' && response.result?.clientId,
        )
        .at(-1).response.result.clientId;
      if (priorScope) {
        expect(currentClientId).not.toBe(priorScope.clientId);
        const priorDraft = await ownedRead(
          'drafts.get',
          { workspaceId, agentId },
          priorScope.clientId,
        );
        expect(priorDraft.text).toBe(priorScope.draft.text);
        expect(priorDraft.attachments).toEqual(priorScope.draft.attachments);
        priorScopeEvidence.push({
          clientId: priorScope.clientId,
          retainedDraft: priorDraft,
          currentClientId,
          currentDraft: initialDraft,
        });
        for (const prior of priorScope.registered) {
          const meta = await rpc('file.getAttachmentInfo', {
            workspaceId,
            attachmentId: prior.attachmentId,
          });
          expect(meta.exists).toBe(true);
          const saved = await rpc('file.readChunk', {
            workspaceId,
            path: meta.path,
            offset: 0,
            length: 65536,
          });
          expect(sha256(Buffer.from(saved.content, 'base64'))).toBe(prior.sha256);
        }
      }
      await expect(
        chips.getByRole('button', { name: 'Remove attachment', exact: true }),
      ).toHaveCount(0);
      await textarea.click();
      const typedAt = replies.length;
      await textarea.pressSequentially(prompt);
      await expect
        .poll(() =>
          replies
            .slice(typedAt)
            .some(
              ({ request, response }) =>
                request.method === 'drafts.set' &&
                request.params.text === prompt &&
                response.result?.ok,
            ),
        )
        .toBe(true);
      await expect(textarea).toHaveValue(prompt);
      await capture('before-native-input');
      expect(errors).toEqual([]);
      await textarea.click();
      await page.evaluate(async (data) => {
        const bytes = Uint8Array.from(window.atob(data), (c) => c.charCodeAt(0));
        await navigator.clipboard.write([
          new window.ClipboardItem({
            'image/png': new window.Blob([bytes], { type: 'image/png' }),
          }),
        ]);
      }, originalPng.toString('base64'));
      await xdo('key', '--clearmodifiers', 'ctrl+v');
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.nativeAttachmentObservation.events.filter(
                (event) =>
                  event.type === 'paste' && event.files.length === 1 && event.files[0].sha256,
              ).length,
          ),
        )
        .toBe(1);
      const paste = await page.evaluate(() =>
        window.nativeAttachmentObservation.events.find((event) => event.type === 'paste'),
      );
      expect(paste.trusted).toBe(true);
      expect(paste.types).toContain('Files');
      expect(paste.files[0]).toMatchObject({ type: 'image/png', isFile: true });
      expect(
        await page.evaluate(() =>
          window.nativeAttachmentObservation.events.some(
            (e) => e.type === 'keydown' && e.key.toLowerCase() === 'v' && e.ctrlKey && e.trusted,
          ),
        ),
      ).toBe(true);
      // Chromium may re-encode clipboard PNGs. The delivered bytes are the wire
      // oracle; independently decoded RGBA pixels prove equivalence to the source.
      const clipboardBytes = Buffer.from(paste.files[0].data, 'base64');
      const deliveredPng = info.outputPath('delivered-clipboard.png');
      await writeFile(deliveredPng, clipboardBytes);
      const decodedClipboard = await rgba(deliveredPng);
      const dimensions = (await exec('/usr/bin/identify', ['-format', '%w %h', deliveredPng]))
        .stdout;
      expect(dimensions).toBe(`${manifest.png.width} ${manifest.png.height}`);
      expect(decodedClipboard).toEqual(decodedOriginal);
      await info.attach('clipboard-pixel-equivalence', {
        body: JSON.stringify({
          originalSha256: sha256(originalPng),
          deliveredSha256: sha256(clipboardBytes),
          originalRgbaSha256: sha256(decodedOriginal),
          deliveredRgbaSha256: sha256(decodedClipboard),
          width: manifest.png.width,
          height: manifest.png.height,
        }),
        contentType: 'application/json',
      });
      await expect(textarea).toHaveValue(prompt);
      const image = await register(paste.files[0], 1);
      await waitDraft([image.attachmentId]);
      await capture('after-clipboard-paste');
      const drop = await dragFile(page, textarea, manifest.drop.path, info, 'first-drop');
      await expect(textarea).toHaveValue(prompt);
      const removed = await register(drop, 2);
      await waitDraft([image.attachmentId, removed.attachmentId]);
      await expect(
        chips.getByRole('button', { name: 'Remove attachment', exact: true }),
      ).toHaveCount(2);
      await capture('after-native-drop');
      const marker = replies.length;
      await chips.getByRole('button', { name: 'Remove attachment', exact: true }).last().click();
      await waitDraft([image.attachmentId], marker);
      await expect(
        chips.getByRole('button', { name: 'Remove attachment', exact: true }),
      ).toHaveCount(1);
      const reselected = await dragFile(page, textarea, manifest.drop.path, info, 'reselect-drop');
      const file = await register(reselected, 3);
      const submittedIds = [image.attachmentId, file.attachmentId];
      await waitDraft(submittedIds);
      await captureInputs();
      await page.reload();
      await ready();
      await expect(textarea).toHaveValue(prompt);
      for (const item of [image, file]) await expect(chips).toContainText(item.fileName);
      expect(placements()).toHaveLength(3);
      expect(sends()).toHaveLength(0);
      await capture('restored-after-reload');
      const priorSockets = sockets.length;
      await page.evaluate(async () => {
        const module = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname.endsWith('/backend-transport-factory.ts'));
        if (!module) throw new Error('Transport lifetime module missing');
        const { resolveBackendTransport } = await import(module.name);
        const socket = resolveBackendTransport().socket;
        if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
          throw new Error('Owned open socket required');
        await new Promise((resolve) => {
          socket.addEventListener('close', resolve, { once: true });
          socket.close();
        });
      });
      await context.setOffline(true);
      await expect(page.getByTestId('workspace-conversation')).toHaveCount(0);
      await context.setOffline(false);
      await ready();
      expect(sockets.length).toBeGreaterThan(priorSockets);
      expect(sockets[priorSockets - 1].closed).toBe(true);
      for (const item of [image, file]) await expect(chips).toContainText(item.fileName);
      expect((await getDraft()).attachments.map((a) => a.attachmentId)).toEqual(submittedIds);
      expect(placements()).toHaveLength(3);
      expect(sends()).toHaveLength(0);
      await capture('restored-after-reconnect');

      await expect(textarea).toHaveValue(prompt);
      expect((await getDraft()).text).toBe(prompt);
      await capture('ready-for-explicit-send');
      await composer.getByRole('button', { name: 'Send', exact: true }).click();
      await expect.poll(() => sends().length).toBe(1);
      const request = sends()[0];
      expect(request.params).toMatchObject({ workspaceId, agentId, content: prompt });
      expect(request.params.imageBlocks).toEqual([
        { type: 'image', attachmentId: image.attachmentId, mimeType: 'image/png' },
      ]);
      expect(request.params.fileBlocks).toEqual([
        {
          type: 'file',
          attachmentId: file.attachmentId,
          fileName: file.fileName,
          mimeType: 'text/plain',
          size: originalDrop.length,
        },
      ]);
      await expect(page.locator('[data-message-role=assistant]').last()).toContainText(token, {
        timeout: 90000,
      });
      await expect
        .poll(async () => (await independent('agent.getConversation')).turnInFlight, {
          timeout: 90000,
        })
        .toBe(false);
      expect(
        pushes.some((push) => push.kind === 'delta' && JSON.stringify(push).includes(token)),
      ).toBe(true);
      history = await independent('agent.getConversation');
      const users = history.messages.filter((m) => m.role === 'user');
      expect(users).toHaveLength(1);
      [user] = users;
      assistant = history.messages.find(
        (m) =>
          m.role === 'assistant' &&
          m.contentBlocks.some((b) => b.type === 'text' && b.text.includes(token)),
      );
      expect(assistant?.seq).toBeGreaterThan(user.seq);
      expect(user.id).toBe(request.params.messageId);
      expect(user.contentBlocks).toEqual([
        { type: 'text', text: prompt, id: `${user.id}:0` },
        {
          type: 'image',
          attachmentId: image.attachmentId,
          mimeType: 'image/png',
          id: `${user.id}:1`,
        },
        {
          type: 'file',
          attachmentId: file.attachmentId,
          fileName: file.fileName,
          mimeType: 'text/plain',
          size: originalDrop.length,
          id: `${user.id}:2`,
        },
      ]);
      expect(
        history.messages
          .flatMap((m) => m.contentBlocks)
          .filter((b) => ['tool_use', 'tool_result'].includes(b.type)),
      ).toEqual([]);
      await expect(textarea).toHaveValue('');
      await expect(
        chips.getByRole('button', { name: 'Remove attachment', exact: true }),
      ).toHaveCount(0);
      await captureInputs();
      await page.reload();
      await ready();
      const row = page.locator(`[data-message-id="${user.id}"]`);
      await expect(row).toContainText(file.fileName);
      await expect(row.locator('img')).toBeVisible();
      expect(
        await row.locator('img').evaluate((img) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
          complete: img.complete,
        })),
      ).toEqual({ width: 96, height: 64, complete: true });
      await capture('persisted-user-attachments', row);
      expect((await independent('agent.getConversation')).messages).toEqual(history.messages);
      for (const item of [image, file]) {
        const saved = await rpc('file.readChunk', {
          workspaceId,
          path: item.path,
          offset: 0,
          length: 65536,
        });
        expect(sha256(Buffer.from(saved.content, 'base64'))).toBe(item.sha256);
      }
      expect(placements()).toHaveLength(3);
      expect(sends()).toHaveLength(1);
      afterRepo = await repoSnapshot();
      afterNotes = await ownedRead('note.list', { workspaceId });
      expect(afterRepo).toEqual(expectedRepo([...(priorScope?.registered ?? []), ...registry]));
      expect(afterNotes).toEqual(f.notesBefore);
      expect(
        requests.filter((r) =>
          /^(note\.(create|setContent|delete)|file\.(write|delete)|workspace\.(create|update|delete)|agent\.(create|queueMessage|stop))$/.test(
            r.method,
          ),
        ),
      ).toEqual([]);
      if (priorScope) {
        const retained = await ownedRead(
          'drafts.get',
          { workspaceId, agentId },
          priorScope.clientId,
        );
        expect(retained).toEqual(priorScopeEvidence[0].retainedDraft);
        priorScopeEvidence.push({ clientId: priorScope.clientId, retainedAfter: retained });
      }
      expect(errors).toEqual([]);
    } catch (error) {
      primaryError = error;
    } finally {
      await context.setOffline(false);
      try {
        if (!page.isClosed()) {
          await captureInputs();
          await page.evaluate(() => window.nativeAttachmentObservation?.remove());
          const active = sockets.at(-1);
          if (await page.getByTestId('workspace-conversation').count()) {
            await page
              .getByTestId('workspace-conversation')
              .getByRole('link', { name: 'Back to Workspace', exact: true })
              .click();
            for (const subscriptionId of active?.subscriptions ?? [])
              await expect
                .poll(() =>
                  replies.some(
                    ({ request, response }) =>
                      request.method === 'chat.unsubscribe' &&
                      request.params.subscriptionId === subscriptionId &&
                      response.result?.success === true,
                  ),
                )
                .toBe(true);
          }
          await page.close();
        }
      } catch (error) {
        cleanupError = String(error);
      }
      await writeFile(
        info.outputPath('native-attachments-evidence.json'),
        JSON.stringify(
          {
            fixture: f,
            initialDraft,
            currentClientId,
            primaryError: primaryError ? String(primaryError) : undefined,
            priorScope,
            priorScopeEvidence,
            proof,
            browserHash,
            versions,
            manifest,
            beforeRepo,
            afterRepo,
            afterNotes,
            requests,
            replies,
            pushes,
            sockets,
            inputs: inputRecords,
            delivered,
            registry,
            geometry,
            history,
            user,
            assistant,
            errors,
            cleanupError,
          },
          null,
          2,
        ),
      );
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw new Error(cleanupError);
  });
}
