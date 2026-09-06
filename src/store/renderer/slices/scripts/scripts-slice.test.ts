import { describe, expect, it } from 'vitest';
import {
  MAX_OUTPUT_CHARS,
  MAX_OUTPUT_CHUNKS,
  appendScriptOutput,
  clearScriptOperations,
  emptyWorkspaceState,
  removeScript,
  restartScriptRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  scriptsReducer,
  setScriptsData,
  startScriptRequested,
  stopScriptRequested,
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
  selectWorkspaceScriptOperations,
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

function makeState(scripts: Record<string, any>): any {
  return {
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
      operations: {},
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

  it('tracks Shell operations per workspace and suppresses a second pending request', () => {
    let state = scriptsReducer(undefined, startScriptRequested(WS, 'script-1'));
    state = scriptsReducer(state, stopScriptRequested(WS, 'script-1'));
    state = scriptsReducer(state, restartScriptRequested('ws-2', 'script-1'));

    expect(state.byWorkspaceId[WS].operations['script-1']).toEqual({
      action: 'start',
      pending: true,
    });
    expect(state.byWorkspaceId['ws-2'].operations['script-1']).toEqual({
      action: 'restart',
      pending: true,
    });

    state = scriptsReducer(state, scriptOperationFailed(WS, 'script-1', 'start', 'offline'));
    expect(state.byWorkspaceId[WS].operations['script-1']).toEqual({
      action: 'start',
      pending: false,
      error: 'offline',
    });
    expect(
      selectWorkspaceScriptOperations.select({ scripts: state } as never, 'ws-2')['script-1'],
    ).toEqual({ action: 'restart', pending: true });
  });

  it('settles only the matching operation and clears one workspace independently', () => {
    let state = scriptsReducer(undefined, stopScriptRequested(WS, 'script-1'));
    state = scriptsReducer(state, scriptOperationSucceeded(WS, 'script-1', 'start'));
    expect(state.byWorkspaceId[WS].operations['script-1']?.pending).toBe(true);

    state = scriptsReducer(state, scriptOperationSucceeded(WS, 'script-1', 'stop'));
    expect(state.byWorkspaceId[WS].operations).toEqual({});

    state = scriptsReducer(state, startScriptRequested(WS, 'script-2'));
    state = scriptsReducer(state, startScriptRequested('ws-2', 'script-2'));
    state = scriptsReducer(state, clearScriptOperations(WS));
    expect(state.byWorkspaceId[WS].operations).toEqual({});
    expect(state.byWorkspaceId['ws-2'].operations['script-2']?.pending).toBe(true);
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
});

describe('scripts selectors', () => {
  it('returns stored script entries without adding runtime by spreading', () => {
    const runtime = makeRuntime({ status: 'running', pid: 123 });
    const entry = makeScriptEntry({ id: 'script-1' }, runtime);
    const state = makeState({ 'script-1': entry });

    expect(selectScriptEntries.select(state, WS)).toEqual([entry]);
    expect(selectScriptEntries.select(state, WS)[0]).toBe(entry);
    expect(selectWorkspaceScriptEntries.select(state, WS)[0]).toBe(entry);
  });

  it('defaults runtime selectors for missing scripts and legacy partial entries', () => {
    const legacyEntry = makeScript({ id: 'legacy-1' }) as any;
    const state = makeState({ 'legacy-1': legacyEntry });

    expect(selectScriptRuntime.select(state, WS, 'legacy-1')).toEqual(makeRuntime());
    expect(selectWorkspaceScriptRuntime.select(state, WS, 'missing')).toEqual(makeRuntime());
    expect(selectRunningScripts.select(state, WS)).toEqual([]);
  });

  it('selects scripts initialized state', () => {
    // uninitialized state
    const uninitState = {
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
    expect(selectScriptsInitialized.select(uninitState, WS)).toBe(false);
    expect(selectWorkspaceScriptsInitialized.select(uninitState, WS)).toBe(false);

    // initialized state
    const initState = {
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
    expect(selectScriptsInitialized.select(initState, WS)).toBe(true);
    expect(selectWorkspaceScriptsInitialized.select(initState, WS)).toBe(true);

    // no workspace state defaults to false
    const noWsState = {
      scripts: {
        byWorkspaceId: {},
      },
    };
    expect(selectScriptsInitialized.select(noWsState, WS)).toBe(false);
    expect(selectWorkspaceScriptsInitialized.select(noWsState, WS)).toBe(false);
  });
});
