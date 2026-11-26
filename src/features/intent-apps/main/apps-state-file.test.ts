import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntentApp } from '../../../shared/intent-apps/intent-apps-types';
import { AppsStateFileWriter, buildAppsStateFile, intentStateDir } from './apps-state-file';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function app(id: string, name: string, approved: boolean, icon: string | null = null): IntentApp {
  return {
    id,
    name,
    version: '1.0.0',
    description: null,
    icon,
    entry: 'index.html',
    bundleHash: `sha256:${id}`,
    fileCount: 1,
    sizeBytes: 10,
    permissions: { level: 1, features: [] },
    window: { width: 960, height: 640, minWidth: null, minHeight: null, resizable: true, alwaysOnTop: false },
    approval: {
      status: approved ? 'approved' : 'pending',
      level: approved ? 1 : null,
      features: [],
      bundleHash: approved ? `sha256:${id}` : null,
      approvedAt: approved ? '2026-11-26T12:00:00.000Z' : null,
    },
    source: null,
    publisher: null,
    updateUrl: null,
    signature: null,
    installedAt: '2026-11-26T11:59:00.000Z',
    updatedAt: '2026-11-26T11:59:00.000Z',
    open: false,
  };
}

describe('Intent OS apps state file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'intent-apps-state-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lives in $XDG_STATE_HOME/intent, with the XDG default', () => {
    expect(intentStateDir({ XDG_STATE_HOME: '/state' }, '/home/u')).toBe('/state/intent');
    expect(intentStateDir({}, '/home/u')).toBe('/home/u/.local/state/intent');
    expect(intentStateDir({ XDG_STATE_HOME: 'relative' }, '/home/u')).toBe(
      '/home/u/.local/state/intent',
    );
  });

  it('lists approved apps only, in app.list order, with the window title (spec 3.5)', () => {
    const doc = buildAppsStateFile(
      [app('notes', 'Notes', true), app('draft', 'Draft', false), app('timer', 'Timer', true)],
      (entry) => (entry.id === 'timer' ? '/s/app-icons/timer.png' : null),
    );
    expect(doc).toEqual({
      version: 1,
      apps: [
        { id: 'notes', name: 'Notes', icon: null, windowTitle: 'Intent App: Notes' },
        {
          id: 'timer',
          name: 'Timer',
          icon: '/s/app-icons/timer.png',
          windowTitle: 'Intent App: Timer',
        },
      ],
    });
  });

  it('writes the file atomically with absolute PNG icon paths and drops stale icons', async () => {
    const readIcon = vi.fn(async () => PNG);
    const writer = new AppsStateFileWriter(dir, readIcon);
    await writer.write([app('timer', 'Timer', true, 'icon.png'), app('notes', 'Notes', true)]);
    const doc = JSON.parse(await fs.readFile(path.join(dir, 'apps.json'), 'utf8'));
    const iconPath = path.join(dir, 'app-icons', 'timer.png');
    expect(doc.apps).toEqual([
      { id: 'timer', name: 'Timer', icon: iconPath, windowTitle: 'Intent App: Timer' },
      { id: 'notes', name: 'Notes', icon: null, windowTitle: 'Intent App: Notes' },
    ]);
    expect(await fs.readFile(iconPath)).toEqual(PNG);
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    await writer.write([app('notes', 'Notes', true)]);
    await expect(fs.access(iconPath)).rejects.toThrow();
    const next = JSON.parse(await fs.readFile(path.join(dir, 'apps.json'), 'utf8'));
    expect(next.apps.map((entry: { id: string }) => entry.id)).toEqual(['notes']);
  });

  it('never writes a file that is not a PNG as an icon', async () => {
    const writer = new AppsStateFileWriter(dir, async () => Buffer.from('<svg/>'));
    await writer.write([app('timer', 'Timer', true, 'icon.svg')]);
    const doc = JSON.parse(await fs.readFile(path.join(dir, 'apps.json'), 'utf8'));
    expect(doc.apps[0].icon).toBeNull();
  });
});
