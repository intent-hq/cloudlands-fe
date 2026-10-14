import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { test, expect, openFixture } from '../../lib/functional.mjs';

if (!process.env.DISPLAY || !process.env.PARITY_NATIVE_CHROMIUM) {
  throw new Error(
    'External file drop requires an owned X11 desktop and PARITY_NATIVE_CHROMIUM. See NATIVE_COMPOSER_DROP.md.',
  );
}

const exec = promisify(execFile);
const xdo = async (...args) =>
  (await exec('/usr/bin/xdotool', args, { timeout: 5_000 })).stdout.trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const browserHash = '8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e';

async function windowGeometry(id) {
  return Object.fromEntries(
    (await xdo('getwindowgeometry', '--shell', id))
      .split('\n')
      .map((entry) => entry.split('='))
      .map(([key, value]) => [key, Number(value)]),
  );
}

async function desktop(info, name) {
  const file = info.outputPath(`${name}.png`);
  await exec('/usr/bin/import', ['-window', 'root', file], { timeout: 5_000 });
  await info.attach(name, { path: file, contentType: 'image/png' });
}

// Actual PCManFM XDND source. xdotool sends XTest pointer input to the owned
// desktop; no browser DragData, FileList, dispatchEvent or callback injection.
async function dragFile(page, fixture, file, info, step) {
  await page.bringToFront();
  await fixture.scrollIntoViewIfNeeded();
  const field = fixture.getByRole('textbox');
  await expect(field).toBeInViewport({ ratio: 1 });
  const box = await field.boundingBox();
  const browserWindow = await page.evaluate(() => ({
    x: globalThis.screenX,
    y: globalThis.screenY,
    border: (globalThis.outerWidth - globalThis.innerWidth) / 2,
    top: globalThis.outerHeight - globalThis.innerHeight,
  }));
  const destination = {
    x: Math.round(browserWindow.x + browserWindow.border + box.x + box.width / 2),
    y: Math.round(browserWindow.y + browserWindow.top + box.y + box.height / 2),
  };
  const config = info.outputPath(`desktop-config-${step}`);
  await mkdir(config, { recursive: true });
  const child = spawn(
    '/usr/bin/pcmanfm',
    ['--new-win', '--role', 'composer-os-drop', path.dirname(file)],
    {
      env: { ...process.env, XDG_CONFIG_HOME: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    let id;
    await expect
      .poll(
        async () => {
          const found = await xdo('search', '--onlyvisible', '--pid', String(child.pid)).catch(
            () => '',
          );
          const windows = found.split('\n').filter(Boolean);
          if (windows.length !== 1) return windows.length;
          id = windows[0];
          return windows.length;
        },
        { message: 'Exactly one owned PCManFM window must become visible' },
      )
      .toBe(1);
    await xdo('windowmove', id, '10', '20', 'windowsize', id, '560', '700');
    await xdo('windowactivate', '--sync', id);
    await expect.poll(() => xdo('getwindowname', id)).toBe(path.basename(path.dirname(file)));
    const sourceWindow = await windowGeometry(id);
    expect(sourceWindow.WIDTH).toBe(560);
    expect(sourceWindow.HEIGHT).toBe(700);
    // Pinned PCManFM default icon view, one real file per directory. The source
    // icon and selected filename are retained in desktop screenshots. Wrong
    // coordinates or a changed desktop must fail the native delivery assertions.
    const source = { x: sourceWindow.X + 202, y: sourceWindow.Y + 95 };
    await xdo('key', 'ctrl+a');
    await xdo('mousemove', '--sync', String(source.x), String(source.y));
    await desktop(info, `${step}-source-selected`);
    const start = await page.evaluate(() => globalThis.composerOsDrop.events.length);
    await xdo('mousedown', '1');
    await xdo('mousemove', '--sync', String(source.x + 50), String(source.y + 50));
    await xdo('mousemove', '--sync', String(destination.x), String(destination.y));
    const overs = () =>
      page.evaluate(
        (index) =>
          globalThis.composerOsDrop.events.slice(index).filter((event) => event.type === 'dragover')
            .length,
        start,
      );
    await expect
      .poll(overs, { message: 'Real desktop drag must enter the composer' })
      .toBeGreaterThan(0);
    const firstOverCount = await overs();
    // A second native motion lets the XDND source receive the target's accepted
    // operation before button release. Wait on actual delivery, not a sleep.
    await xdo('mousemove', '--sync', String(destination.x + 2), String(destination.y + 2));
    await expect.poll(overs).toBeGreaterThan(firstOverCount);
    await xdo('mouseup', '1');
    await expect
      .poll(
        () =>
          page.evaluate(
            (index) =>
              globalThis.composerOsDrop.events
                .slice(index)
                .filter((event) => event.type === 'drop' && event.files.every((f) => f.sha256))
                .length,
            start,
          ),
        { message: 'Native source must deliver actual File bytes to the composer' },
      )
      .toBe(1);
    const events = await page.evaluate(
      (index) => globalThis.composerOsDrop.events.slice(index),
      start,
    );
    expect(events.every((event) => event.trusted)).toBe(true);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      expect(
        events.some((event) => event.type === type && event.types.includes('Files')),
        type,
      ).toBe(true);
    }
    const acceptedOver = events.filter((event) => event.type === 'dragover').at(-1);
    expect(acceptedOver.defaultPrevented).toBe(true);
    expect(acceptedOver.dropEffect).toBe('copy');
    const metadata = await stat(file);
    const dropped = events.find((event) => event.type === 'drop').files;
    expect(dropped).toEqual([
      {
        name: path.basename(file),
        size: metadata.size,
        type: file.endsWith('.png') ? 'image/png' : 'text/plain',
        lastModified: Math.trunc(metadata.mtimeMs),
        isFile: true,
        sha256: sha256(await readFile(file)),
      },
    ]);
    await info.attach(`${step}-native-delivery`, {
      body: JSON.stringify({ sourceWindow, source, browserWindow, destination, events }),
      contentType: 'application/json',
    });
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

test('composer external OS drop: actual desktop files obey accept, dedup and accumulated maxFiles before ordinary send', async ({
  page,
  browser,
}, info) => {
  expect(await browser.version()).toBe('153.0.8010.12');
  expect(sha256(await readFile(process.env.PARITY_NATIVE_CHROMIUM))).toBe(browserHash);
  const versions = (
    await exec('dpkg-query', ['-W', '-f=${Package}=${Version}\n', 'pcmanfm', 'xdotool', 'openbox'])
  ).stdout;
  expect(versions).toContain('pcmanfm=1.3.2-4build2');
  expect(versions).toContain('xdotool=1:3.20160805.1-5build1');
  expect(versions).toContain('openbox=3.6.1-12build5');
  const requests = [];
  const sockets = [];
  page.on('request', (request) => {
    if (!['data:', 'blob:'].includes(new URL(request.url()).protocol))
      requests.push({ url: request.url(), method: request.method() });
  });
  page.on('websocket', (socket) => sockets.push(socket.url()));
  const files = {};
  for (const name of ['accepted.png', 'rejected.txt', 'next.png', 'overflow.png']) {
    const dir = info.outputPath(`files-${name}`);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    if (name.endsWith('.png'))
      await copyFile(new URL('../../../../static/favicon.png', import.meta.url), file);
    else
      await writeFile(
        file,
        'Real local text; not admitted by the public composer accept contract.',
      );
    files[name] = file;
  }
  const fixture = await openFixture(page, 'message-composer', 'max-files');
  await page.evaluate(() => globalThis.document.fonts.ready);
  await fixture.scrollIntoViewIfNeeded();
  await fixture.evaluate((node) => {
    const observation = { events: [], node, types: ['dragenter', 'dragover', 'drop'] };
    observation.listener = (event) => {
      if (!node.contains(event.target)) return;
      const files = Array.from(event.dataTransfer.files);
      const record = {
        type: event.type,
        trusted: event.isTrusted,
        types: Array.from(event.dataTransfer.types),
        files: [],
      };
      observation.events.push(record);
      // Observation only; never prevent, redispatch or alter the native event.
      record.defaultPrevented = event.defaultPrevented;
      record.dropEffect = event.dataTransfer.dropEffect;
      for (const file of files) {
        const result = {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          isFile: file instanceof globalThis.File,
        };
        record.files.push(result);
        file.arrayBuffer().then(async (bytes) => {
          const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
          result.sha256 = Array.from(new Uint8Array(hash), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
        });
      }
    };
    for (const type of observation.types) globalThis.addEventListener(type, observation.listener);
    globalThis.composerOsDrop = observation;
  });
  const before = await fixture.boundingBox();
  const tiles = fixture.getByRole('button', { name: /^Remove / });
  const payload = fixture.locator('[data-composer-sends]');
  try {
    await info.attach('before-external-drop', {
      body: await fixture.screenshot(),
      contentType: 'image/png',
    });
    await expect(tiles).toHaveCount(0);
    await expect(payload).toHaveText('[]');
    const cases = [
      ['accepted.png', ['accepted.png']],
      ['accepted.png', ['accepted.png']],
      ['rejected.txt', ['accepted.png']],
      ['next.png', ['accepted.png', 'next.png']],
      ['overflow.png', ['accepted.png', 'next.png']],
    ];
    for (const [index, [name, retained]] of cases.entries()) {
      await dragFile(page, fixture, files[name], info, String(index + 1));
      await expect(tiles).toHaveCount(retained.length);
      for (const [position, filename] of retained.entries()) {
        await expect(tiles.nth(position)).toHaveAccessibleName(`Remove ${filename}`);
      }
      await expect(payload).toHaveText('[]');
    }
    await expect(fixture.getByText('2 attached', { exact: true })).toBeVisible();
    await info.attach('accepted-files-before-send', {
      body: await fixture.screenshot(),
      contentType: 'image/png',
    });
    await fixture.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(payload).toHaveText(
      JSON.stringify([{ text: '', files: ['accepted.png', 'next.png'] }]),
    );
    await expect(fixture.getByRole('textbox')).toHaveValue('');
  } finally {
    const events = await page.evaluate(() => {
      const observation = globalThis.composerOsDrop;
      for (const type of observation.types)
        globalThis.removeEventListener(type, observation.listener);
      return observation.events;
    });
    await info.attach('os-file-drop-contract', {
      body: JSON.stringify({
        browser: browser.version(),
        browserHash,
        versions,
        input: 'PCManFM native XDND via XTest pointer input; no injected browser payload',
        maxFiles: 2,
        accept: 'image/png,image/jpeg,application/pdf',
        before,
        after: await fixture.boundingBox(),
        events,
        requests,
        sockets,
      }),
      contentType: 'application/json',
    });
    await info.attach('after-external-drop', {
      body: await fixture.screenshot(),
      contentType: 'image/png',
    });
    expect(sockets).toEqual([]);
    expect(
      requests.every(
        (request) =>
          request.method === 'GET' && new URL(request.url).origin === new URL(page.url()).origin,
      ),
    ).toBe(true);
  }
});
