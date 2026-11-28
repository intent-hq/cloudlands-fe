import { describe, expect, it } from 'vitest';
import {
  mergeParkedFrames,
  migrateWindowSessions,
  orderFramesForRestore,
  parseWindowFramesFile,
  keepFrameMachines,
  routeFromRendererUrl,
  type FrameSessionFilter,
} from '../frame-sessions';
import type { FrameSession } from '../../shared/types/machine-rail';

const BOUNDS = { x: 10, y: 20, width: 1200, height: 800 };
const OTHER_BOUNDS = { x: 1930, y: 0, width: 900, height: 700 };

const acceptAll: FrameSessionFilter = {
  isSavedMachine: () => true,
  isRestorableRoute: (route: string) => route !== '/dock' && route !== '/dev-console',
};

function onlySaved(...ids: string[]): FrameSessionFilter {
  return { ...acceptAll, isSavedMachine: (id: string) => ids.includes(id) };
}

function frame(ids: string[], selectedId = ids[0]): FrameSession {
  return { bounds: BOUNDS, machines: ids.map((id) => ({ id })), selectedId };
}

describe('migrateWindowSessions (window-sessions.json → frames)', () => {
  it('turns the oldest bare session array into local frames, in order', () => {
    const legacy = [
      { route: '/workspace/abc', bounds: BOUNDS },
      { route: '/workspace/def', bounds: OTHER_BOUNDS, isFullScreen: true },
    ];
    expect(migrateWindowSessions(legacy, 'local', acceptAll)).toEqual([
      { bounds: BOUNDS, machines: [{ id: 'local', route: '/workspace/abc' }], selectedId: 'local' },
      {
        bounds: OTHER_BOUNDS,
        isFullScreen: true,
        machines: [{ id: 'local', route: '/workspace/def' }],
        selectedId: 'local',
      },
    ]);
  });

  it('turns every session of a multi-backend map into a frame on its backend', () => {
    const map = {
      local: [{ route: '/workspace/a', bounds: BOUNDS }],
      'remote-1': [
        { route: '/workspace/b', bounds: OTHER_BOUNDS },
        { route: '/hud', bounds: BOUNDS },
      ],
    };
    expect(migrateWindowSessions(map, 'local', acceptAll)).toEqual([
      { bounds: BOUNDS, machines: [{ id: 'local', route: '/workspace/a' }], selectedId: 'local' },
      {
        bounds: OTHER_BOUNDS,
        machines: [{ id: 'remote-1', route: '/workspace/b' }],
        selectedId: 'remote-1',
      },
      { bounds: BOUNDS, machines: [{ id: 'remote-1', route: '/hud' }], selectedId: 'remote-1' },
    ]);
  });

  it("puts a session's rail machines after its backend and keeps the machine it showed", () => {
    const map = {
      local: [
        {
          route: '/workspace/a',
          bounds: BOUNDS,
          rail: { machineIds: ['remote-1', 'remote-2'], selectedId: 'remote-2' },
        },
      ],
    };
    expect(migrateWindowSessions(map, 'local', acceptAll)).toEqual([
      {
        bounds: BOUNDS,
        machines: [{ id: 'local', route: '/workspace/a' }, { id: 'remote-1' }, { id: 'remote-2' }],
        selectedId: 'remote-2',
      },
    ]);
  });

  it('shows the backend when the rail selection is missing or not in the rail', () => {
    const map = {
      local: [
        { route: '/a', bounds: BOUNDS, rail: { machineIds: ['remote-1'] } },
        { route: '/b', bounds: BOUNDS, rail: { machineIds: ['remote-1'], selectedId: 'gone' } },
      ],
    };
    expect(migrateWindowSessions(map, 'local', acceptAll).map((f) => f.selectedId)).toEqual([
      'local',
      'local',
    ]);
  });

  it('drops machines that are no longer saved, opening on the next one when the backend is gone', () => {
    const map = {
      forgotten: [
        {
          route: '/workspace/x',
          bounds: BOUNDS,
          rail: { machineIds: ['remote-1', 'also-gone'], selectedId: 'also-gone' },
        },
        { route: '/workspace/y', bounds: BOUNDS },
      ],
      local: [{ route: '/workspace/z', bounds: BOUNDS, rail: { machineIds: ['also-gone'] } }],
    };
    expect(migrateWindowSessions(map, 'local', onlySaved('local', 'remote-1'))).toEqual([
      { bounds: BOUNDS, machines: [{ id: 'remote-1' }], selectedId: 'remote-1' },
      { bounds: BOUNDS, machines: [{ id: 'local', route: '/workspace/z' }], selectedId: 'local' },
    ]);
  });

  it('skips invalid sessions, duplicate rail entries and non-array buckets', () => {
    const map = {
      local: [
        null,
        'nope',
        { route: 42, bounds: BOUNDS },
        { route: '/workspace/a' },
        { route: '/workspace/b', bounds: { x: 0, y: 0, width: '1200', height: 800 } },
        {
          route: '/workspace/c',
          bounds: BOUNDS,
          rail: { machineIds: ['local', 'remote-1', 'remote-1', 7], selectedId: 'remote-1' },
        },
      ],
      'remote-2': { route: '/workspace/d', bounds: BOUNDS },
    };
    expect(migrateWindowSessions(map, 'local', acceptAll)).toEqual([
      {
        bounds: BOUNDS,
        machines: [{ id: 'local', route: '/workspace/c' }, { id: 'remote-1' }],
        selectedId: 'remote-1',
      },
    ]);
  });

  it('never migrates a dock or console page as a window', () => {
    const map = {
      local: [
        { route: '/dock', bounds: BOUNDS },
        { route: '/dev-console', bounds: BOUNDS },
        { route: '/workspace/a', bounds: BOUNDS },
      ],
    };
    expect(migrateWindowSessions(map, 'local', acceptAll)).toEqual([
      { bounds: BOUNDS, machines: [{ id: 'local', route: '/workspace/a' }], selectedId: 'local' },
    ]);
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['a string', 'corrupt'],
    ['an empty map', {}],
    ['an empty array', []],
  ])('migrates %s to no frames', (_label, data) => {
    expect(migrateWindowSessions(data, 'local', acceptAll)).toEqual([]);
  });

  it('keeps at most 20 frames', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => ({ route: `/w/${i}`, bounds: BOUNDS }));
    const frames = migrateWindowSessions(sessions, 'local', acceptAll);
    expect(frames).toHaveLength(20);
    expect(frames[19].machines[0].route).toBe('/w/19');
  });
});

describe('parseWindowFramesFile', () => {
  it('reads a version-1 file, keeping every machine route', () => {
    const file = {
      version: 1,
      frames: [
        {
          bounds: BOUNDS,
          isFullScreen: true,
          machines: [
            { id: 'local', route: '/workspace/a' },
            { id: 'remote-1', route: '/workspace/b' },
          ],
          selectedId: 'remote-1',
        },
      ],
    };
    expect(parseWindowFramesFile(file, acceptAll)).toEqual(file.frames);
  });

  it.each([
    ['a bare array', []],
    ['another version', { version: 2, frames: [] }],
    ['a file without frames', { version: 1 }],
    ['null', null],
  ])('rejects %s', (_label, data) => {
    expect(parseWindowFramesFile(data, acceptAll)).toBeNull();
  });

  it('reads an empty frames list as no frames (all windows were closed)', () => {
    expect(parseWindowFramesFile({ version: 1, frames: [] }, acceptAll)).toEqual([]);
  });
});

describe('saved frame validation', () => {
  const parseOne = (frame: unknown, filter = acceptAll) =>
    parseWindowFramesFile({ version: 1, frames: [frame] }, filter)?.[0] ?? null;

  it('drops a frame with no machine left', () => {
    expect(parseOne({ bounds: BOUNDS, machines: [{ id: 'gone' }] }, onlySaved('local'))).toBeNull();
    expect(parseOne({ bounds: BOUNDS, machines: [] }, acceptAll)).toBeNull();
  });

  it('drops the page of a rail machine that may not reopen, keeping the machine', () => {
    expect(
      parseOne(
        {
          bounds: BOUNDS,
          machines: [
            { id: 'local', route: '/a' },
            { id: 'remote-1', route: '/dock' },
            { id: 'remote-2', route: 'not-a-path' },
          ],
          selectedId: 'local',
        },
        acceptAll,
      ),
    ).toEqual({
      bounds: BOUNDS,
      machines: [{ id: 'local', route: '/a' }, { id: 'remote-1' }, { id: 'remote-2' }],
      selectedId: 'local',
    });
  });

  it('ignores a full-screen flag that is not true', () => {
    expect(
      parseOne({ bounds: BOUNDS, isFullScreen: 'yes', machines: [{ id: 'local' }] }, acceptAll),
    ).toEqual({ bounds: BOUNDS, machines: [{ id: 'local' }], selectedId: 'local' });
  });
});

describe('restore ordering and saving', () => {
  it('restores the frames showing the active machine first, others in saved order', () => {
    const frames = [frame(['a']), frame(['b', 'local'], 'local'), frame(['local', 'b'], 'b')];
    expect(orderFramesForRestore(frames, 'local')).toEqual([
      frame(['b', 'local'], 'local'),
      frame(['a']),
      frame(['local', 'b'], 'b'),
    ]);
  });

  it('keeps frames not restored this run until live frames hold all of their machines', () => {
    const live = [frame(['b', 'local'])];
    const parked = [frame(['local', 'b']), frame(['remote-1']), frame(['remote-2', 'b'])];
    expect(mergeParkedFrames(live, parked)).toEqual([
      frame(['b', 'local']),
      frame(['remote-1']),
      frame(['remote-2', 'b']),
    ]);
  });

  it('keeps the machines still saved, moving a dropped selection to the first kept one', () => {
    const isSaved = (id: string) => id !== 'gone';
    expect(keepFrameMachines(frame(['gone', 'b', 'c'], 'gone'), isSaved)).toEqual(
      frame(['b', 'c'], 'b'),
    );
    expect(keepFrameMachines(frame(['b', 'gone', 'c'], 'c'), isSaved)).toEqual(
      frame(['b', 'c'], 'c'),
    );
    expect(keepFrameMachines(frame(['gone']), isSaved)).toBeNull();
  });
});

describe('routeFromRendererUrl', () => {
  it.each([
    ['app://workspaces/workspace/abc', '/workspace/abc'],
    ['http://127.0.0.1:5190/settings', '/settings'],
    ['file:///app/index.html?initialRoute=%2Fworkspace%2Fx', '/workspace/x'],
    ['file:///app/index.html', '/workspace/new'],
  ])('reads %s as %s', (url, route) => {
    expect(routeFromRendererUrl(url, '/workspace/new')).toBe(route);
  });

  it('has no route before the renderer loaded a page', () => {
    expect(routeFromRendererUrl('', '/workspace/new')).toBeNull();
    expect(routeFromRendererUrl('about:blank', '/workspace/new')).toBeNull();
  });
});

describe('saved tab windows', () => {
  const tab = { id: 'tab-1', type: 'browser', title: 'Page', closable: true };
  const tabWindow = { tabWindowId: 'tw-1', workspaceId: 'ws-1', sourceLayoutId: 'ws-1', tab };

  function read(frames: unknown[], filter = acceptAll) {
    return parseWindowFramesFile({ version: 1, frames }, filter);
  }

  it('keeps a tab window with its record, on its own page, full screen kept', () => {
    expect(
      read([
        {
          bounds: BOUNDS,
          isFullScreen: true,
          machines: [{ id: 'local', route: '/workspace/other' }],
          selectedId: 'local',
          tabWindow: { ...tabWindow, tab: { ...tab, tabWindowId: 'stale' } },
        },
      ]),
    ).toEqual([
      {
        bounds: BOUNDS,
        isFullScreen: true,
        machines: [{ id: 'local', route: '/tab-window/tw-1' }],
        selectedId: 'local',
        tabWindow,
      },
    ]);
  });

  it('drops a tab window with a bad record or a forgotten machine', () => {
    const base = { bounds: BOUNDS, machines: [{ id: 'local' }], selectedId: 'local' };
    expect(read([{ ...base, tabWindow: { ...tabWindow, tabWindowId: '../x' } }])).toEqual([]);
    expect(read([{ ...base, tabWindow: { ...tabWindow, tab: { id: 'tab-1' } } }])).toEqual([]);
    expect(read([{ ...base, tabWindow: { ...tabWindow, workspaceId: '' } }])).toEqual([]);
    expect(read([{ ...base, tabWindow }], onlySaved('remote'))).toEqual([]);
  });

  it('restores tab windows after every app frame, so they never become the main window', () => {
    const tabFrame: FrameSession = {
      bounds: BOUNDS,
      machines: [{ id: 'local', route: '/tab-window/tw-1' }],
      selectedId: 'local',
      tabWindow,
    };
    const app = frame(['local']);
    const remote = frame(['remote']);
    expect(orderFramesForRestore([tabFrame, remote, app], 'local')).toEqual([
      app,
      remote,
      tabFrame,
    ]);
  });
});
