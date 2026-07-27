import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_CHUNKS,
  appendScriptOutput,
  disposeScripts,
  emptyWorkspaceState,
  removeScript,
  scriptsReducer,
  setScriptOutput,
  setScriptsData,
  updateRuntimeState,
  upsertScript,
} from './scripts-slice';
import type {
  ScriptOutputChunk,
  ScriptRuntimeState,
  ScriptWithState,
  WorkspaceScript,
} from './scripts-types';
import {
  selectRunningScripts,
  selectScriptEntries,
  selectScriptRuntime,
  selectScriptsInitialized,
  selectWorkspaceScriptEntries,
  selectWorkspaceScriptRuntime,
  selectWorkspaceScriptsInitialized,
} from './scripts-selectors';

const WS = 'ws-1';

function makeScript(overrides: Partial<WorkspaceScript> = {}): WorkspaceScript {
  return {
    id: 'script-1',
    workspaceId: WS,
    name: 'Dev Server',
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<ScriptRuntimeState> = {}): ScriptRuntimeState {
  return {
    status: 'idle',
    restartCount: 0,
    ...overrides,
  };
}

function makeScriptEntry(
  overrides: Partial<WorkspaceScript> = {},
  runtime: ScriptRuntimeState = makeRuntime(),
): ScriptWithState {
  return { ...makeScript(overrides), runtime };
}

function makeChunk(index: number, text = `chunk ${index}\n`): ScriptOutputChunk {
  return {
    text,
    timestamp: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
  };
}

function makeState(scripts: Record<string, any>, activeWorkspaceId: string | null = WS): any {
  return {
    workspace: { activeWorkspaceId },
    scripts: {
      byWorkspaceId: {
        [WS]: {
          ...emptyWorkspaceState,
          scripts,
        },
      },
    },
  };
}

describe('scriptsReducer', () => {
  it('returns the initial state', () => {
    expect(scriptsReducer(undefined, { type: '@@INIT' })).toEqual({ byWorkspaceId: {} });
    expect(emptyWorkspaceState).toEqual({
      scripts: {},
      outputBuffers: {},
      initialized: false,
      loading: false,
    });
  });

  it('bulk sets script entries with embedded runtime', () => {
    const running = makeRuntime({
      status: 'running',
      pid: 123,
      startedAt: '2026-01-01T00:00:01.000Z',
    });
    const entry = makeScriptEntry({ id: 'script-1' }, running);

    const state = scriptsReducer(undefined, setScriptsData(WS, [entry]));

    expect(state.byWorkspaceId[WS].scripts).toEqual({ 'script-1': entry });
    expect(state.byWorkspaceId[WS].scripts['script-1'].runtime).toEqual(running);
    expect('runtimeStates' in state.byWorkspaceId[WS]).toBe(false);
  });

  it('upserts new scripts with default runtime', () => {
    const script = makeScript({ id: 'script-1' });

    const state = scriptsReducer(undefined, upsertScript(WS, script));

    expect(state.byWorkspaceId[WS].scripts['script-1']).toEqual({
      ...script,
      runtime: makeRuntime(),
    });
  });

  it('preserves existing runtime when upserting script metadata', () => {
    const existingRuntime = makeRuntime({ status: 'running', pid: 456, restartCount: 2 });
    let state = scriptsReducer(
      undefined,
      setScriptsData(WS, [makeScriptEntry({ id: 'script-1', name: 'Old' }, existingRuntime)]),
    );

    state = scriptsReducer(state, upsertScript(WS, makeScript({ id: 'script-1', name: 'New' })));

    expect(state.byWorkspaceId[WS].scripts['script-1'].name).toBe('New');
    expect(state.byWorkspaceId[WS].scripts['script-1'].runtime).toEqual(existingRuntime);
  });

  it('partially updates embedded runtime state', () => {
    let state = scriptsReducer(undefined, upsertScript(WS, makeScript({ id: 'script-1' })));

    state = scriptsReducer(
      state,
      updateRuntimeState(WS, 'script-1', { status: 'running', pid: 789 }),
    );

    expect(state.byWorkspaceId[WS].scripts['script-1'].runtime).toEqual({
      status: 'running',
      restartCount: 0,
      pid: 789,
    });
  });

  it('removes scripts and their output buffers', () => {
    let state = scriptsReducer(
      undefined,
      setScriptsData(WS, [makeScriptEntry({ id: 'script-1' })]),
    );
    state = scriptsReducer(state, setScriptOutput(WS, 'script-1', [makeChunk(1)]));

    state = scriptsReducer(state, removeScript(WS, 'script-1'));

    expect(state.byWorkspaceId[WS].scripts['script-1']).toBeUndefined();
    expect(state.byWorkspaceId[WS].outputBuffers['script-1']).toBeUndefined();
  });

  it('appends raw chunks verbatim — no line splitting, no injected newlines', () => {
    let state = scriptsReducer(undefined, upsertScript(WS, makeScript({ id: 'script-1' })));
    state = scriptsReducer(
      state,
      appendScriptOutput(WS, 'script-1', makeChunk(1, 'partial line, no newl')),
    );
    state = scriptsReducer(
      state,
      appendScriptOutput(WS, 'script-1', makeChunk(2, 'ine\r\nnext\r')),
    );

    const buffer = state.byWorkspaceId[WS].outputBuffers['script-1'];
    expect(buffer.chunks.map((c) => c.text)).toEqual(['partial line, no newl', 'ine\r\nnext\r']);
    expect(buffer.dropped).toBe(0);
    expect(buffer.chunks.map((c) => c.text).join('')).toBe('partial line, no newline\r\nnext\r');
  });

  it('evicts oldest chunks past the chunk cap and counts them as dropped', () => {
    let state = scriptsReducer(undefined, upsertScript(WS, makeScript({ id: 'script-1' })));
    state = scriptsReducer(state, setScriptOutput(WS, 'script-1', [makeChunk(1)]));

    for (let i = 0; i < MAX_OUTPUT_CHUNKS + 1; i++) {
      state = scriptsReducer(state, appendScriptOutput(WS, 'script-1', makeChunk(i + 2)));
    }

    const buffer = state.byWorkspaceId[WS].outputBuffers['script-1'];
    expect(buffer.chunks).toHaveLength(MAX_OUTPUT_CHUNKS);
    expect(buffer.dropped).toBe(2);
    expect(buffer.chunks[0].text).toBe('chunk 3\n');
  });

  it('evicts oldest chunks past the char cap but always keeps the newest chunk', () => {
    const big = 'x'.repeat(MAX_OUTPUT_CHARS);
    let state = scriptsReducer(undefined, upsertScript(WS, makeScript({ id: 'script-1' })));
    state = scriptsReducer(state, appendScriptOutput(WS, 'script-1', makeChunk(1, big)));
    state = scriptsReducer(state, appendScriptOutput(WS, 'script-1', makeChunk(2, big)));

    const buffer = state.byWorkspaceId[WS].outputBuffers['script-1'];
    expect(buffer.chunks).toHaveLength(1);
    expect(buffer.dropped).toBe(1);
    expect(buffer.chunks[0].timestamp).toBe(makeChunk(2).timestamp);
  });

  it('disposes workspace scripts state', () => {
    let state = scriptsReducer(undefined, upsertScript(WS, makeScript({ id: 'script-1' })));
    state = scriptsReducer(
      state,
      upsertScript('ws-2', makeScript({ id: 'script-2', workspaceId: 'ws-2' })),
    );

    state = scriptsReducer(state, disposeScripts(WS));

    expect(state.byWorkspaceId[WS]).toBeUndefined();
    expect(state.byWorkspaceId['ws-2']).toBeDefined();
  });
});

describe('scripts selectors', () => {
  it('returns stored script entries without adding runtime by spreading', () => {
    const runtime = makeRuntime({ status: 'running', pid: 123 });
    const entry = makeScriptEntry({ id: 'script-1' }, runtime);
    const state = makeState({ 'script-1': entry });

    expect(selectScriptEntries.select(state)).toEqual([entry]);
    expect(selectScriptEntries.select(state)[0]).toBe(entry);
    expect(selectWorkspaceScriptEntries.select(state, WS)[0]).toBe(entry);
  });

  it('defaults runtime selectors for missing scripts and legacy partial entries', () => {
    const legacyEntry = makeScript({ id: 'legacy-1' }) as any;
    const state = makeState({ 'legacy-1': legacyEntry });

    expect(selectScriptRuntime.select(state, 'legacy-1')).toEqual(makeRuntime());
    expect(selectWorkspaceScriptRuntime.select(state, WS, 'missing')).toEqual(makeRuntime());
    expect(selectRunningScripts.select(state)).toEqual([]);
  });

  it('selects scripts initialized state', () => {
    // uninitialized state
    const uninitState = {
      workspace: { activeWorkspaceId: WS },
      scripts: {
        byWorkspaceId: {
          [WS]: {
            ...emptyWorkspaceState,
            initialized: false,
            scripts: {},
          },
        },
      },
    };
    expect(selectScriptsInitialized.select(uninitState)).toBe(false);
    expect(selectWorkspaceScriptsInitialized.select(uninitState, WS)).toBe(false);

    // initialized state
    const initState = {
      workspace: { activeWorkspaceId: WS },
      scripts: {
        byWorkspaceId: {
          [WS]: {
            ...emptyWorkspaceState,
            initialized: true,
            scripts: {},
          },
        },
      },
    };
    expect(selectScriptsInitialized.select(initState)).toBe(true);
    expect(selectWorkspaceScriptsInitialized.select(initState, WS)).toBe(true);

    // no workspace state defaults to false
    const noWsState = {
      workspace: { activeWorkspaceId: WS },
      scripts: {
        byWorkspaceId: {},
      },
    };
    expect(selectScriptsInitialized.select(noWsState)).toBe(false);
    expect(selectWorkspaceScriptsInitialized.select(noWsState, WS)).toBe(false);
  });
});
