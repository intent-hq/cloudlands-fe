import { describe, expect, it } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { StoreState } from '../../types';
import type { BackendTransportInfo } from '../daemon-health/daemon-health-types';
import type { InstalledEditor } from './external-editors-slice';
import {
  selectEditorOrder,
  selectInstalledEditors,
  selectInstalledEditorsFiltered,
  selectHiddenEditorIds,
  selectLastFetched,
  selectOpenAction,
} from './external-editors-selectors';

const mockEditors: InstalledEditor[] = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    priority: 100,
    installed: true,
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    shortLabel: 'iTerm',
    appName: 'iTerm',
    category: 'terminal',
    handlerType: 'generic',
    priority: 50,
    installed: true,
  },
  {
    id: 'finder',
    name: 'Finder',
    shortLabel: 'Finder',
    appName: 'Finder',
    category: 'finder',
    handlerType: 'finder',
    priority: 0,
    installed: false,
  },
];

const mockWorkspaces = [
  { id: 'ws-local' },
  { id: 'ws-remote', environmentConfig: { type: 'remote' } },
];

function mockState(
  editors: InstalledEditor[] = mockEditors,
  transport: BackendTransportInfo | null = { mode: 'sidecar-uds' },
): StoreState {
  return {
    externalEditors: {
      selectedAction: 'cursor',
      editors: createCollection<InstalledEditor, 'id'>('id', editors),
      editorOrder: [],
      hiddenEditorIds: ['iterm2'],
      loading: false,
      error: null,
      lastFetched: 123,
    },
    daemonHealth: { transport },
    workspace: {
      workspaces: createCollection('id', mockWorkspaces),
    },
  } as unknown as StoreState;
}

describe('external-editors selectors', () => {
  it('returns the selected open action', () => {
    const state = mockState();
    expect(selectOpenAction.select(state)).toBe('cursor');
  });

  it('returns installed editors as an array', () => {
    const state = mockState();

    expect(selectInstalledEditors.select(state)).toEqual(mockEditors);
  });

  it('orders detected editors by the persisted preference and appends unlisted detections', () => {
    const state = mockState();
    state.externalEditors.editorOrder = ['iterm2', 'missing', 'vscode'];

    expect(selectInstalledEditors.select(state).map((editor) => editor.id)).toEqual([
      'iterm2',
      'vscode',
      'finder',
    ]);
    expect(selectEditorOrder.select(state)).toEqual(['iterm2', 'missing', 'vscode']);
  });

  it('filters to installed editors only', () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state)).toEqual([mockEditors[0]]);
  });

  it('keeps editors offered on an adopted local UDS daemon (external-uds)', () => {
    const state = mockState(mockEditors, { mode: 'external-uds' });

    expect(selectInstalledEditorsFiltered.select(state)).toEqual([mockEditors[0]]);
  });

  it('keeps editors offered before transport info arrives (null transport)', () => {
    const state = mockState(mockEditors, null);

    expect(selectInstalledEditorsFiltered.select(state)).toEqual([mockEditors[0]]);
  });

  it('hides all editor/reveal affordances when the daemon is remote (external-ws)', () => {
    const state = mockState(mockEditors, { mode: 'external-ws' });

    expect(selectInstalledEditorsFiltered.select(state)).toEqual([]);
  });

  it('keeps editors offered for a local workspace on a local daemon', () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state, 'ws-local')).toEqual([mockEditors[0]]);
  });

  it('hides editors for a remote (SSH) workspace even on a local daemon (monorepo#2171)', () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state, 'ws-remote')).toEqual([]);
  });

  it('hides editors for any workspace when the daemon is remote', () => {
    const state = mockState(mockEditors, { mode: 'external-ws' });

    expect(selectInstalledEditorsFiltered.select(state, 'ws-local')).toEqual([]);
  });

  it('treats an unknown workspace entity as local (optimistic default)', () => {
    const state = mockState();

    expect(selectInstalledEditorsFiltered.select(state, 'ws-unknown')).toEqual([mockEditors[0]]);
  });

  it('returns hidden editor ids', () => {
    const state = mockState();

    expect(selectHiddenEditorIds.select(state)).toEqual(['iterm2']);
  });

  it('returns the last fetched timestamp', () => {
    const state = mockState();
    expect(selectLastFetched.select(state)).toBe(123);
  });
});
