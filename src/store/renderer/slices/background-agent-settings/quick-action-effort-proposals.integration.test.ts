import { afterEach, expect, it, vi } from 'vitest';
const { list, update } = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock('$lib/client', () => ({ appClient: { settings: { get: vi.fn(), list, update } } }));
import type { AppSettingChange } from '$lib/client/app-client';
import { findAppSettingDefinition } from '$shared/app-settings-schema';
import { modelSelectionSaga } from '../model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from './sagas/background-agent-settings-saga';
import { store } from '$store/renderer/store';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import {
  applySettingsProposalWork,
  undoSettingsProposalWork,
} from '$lib/components/chat/proposals/settings-proposal-actions';
let stopSaga: (() => void) | undefined;
let stopBackground: (() => void) | undefined;
let dispose: (() => void) | undefined;
afterEach(() => {
  stopSaga?.();
  stopBackground?.();
  dispose?.();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
for (const initial of [{}, { walkthrough: 'low' }]) {
  it(`applies the complete free-form effort map for a settings proposal from ${JSON.stringify(initial)}`, async () => {
    dispose = store.init();
    const snapshot: AppSettingChange[] = [
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'quickActions.defaultModel', value: 'balanced' },
      {
        path: 'quickActions.typeOverrides',
        value: { commit: '', pr: '', review: '', fast: '' },
      },
      { path: 'quickActions.defaultReasoningEffort', value: 'medium' },
      { path: 'quickActions.typeReasoningEffortOverrides', value: initial },
      { path: 'quickActions.providerSettings', value: {} },
    ];
    const saved = new Map(snapshot.map(({ path, value }) => [path, structuredClone(value)]));
    list.mockImplementation(async () =>
      [...saved].map(([path, value]) => ({ path, value: structuredClone(value) })),
    );
    update.mockImplementation(async (changes: AppSettingChange[]) => {
      for (const { path, value } of changes) saved.set(path, structuredClone(value));
      return structuredClone(changes);
    });
    stopBackground = store.runSaga(backgroundAgentSettingsSaga);
    applySettingsChanges(snapshot);
    const desired = Object.keys(initial).length ? {} : { walkthrough: 'high' };
    const result = await applySettingsProposalWork({
      proposal: {
        kind: 'settings-change',
        applyToolCallId: 'freeform-effort',
        payload: {
          changes: [{ path: 'quickActions.typeReasoningEffortOverrides', value: desired }],
        },
        preview: { title: 'Set quick action effort' },
      },
      editedFields: {},
      selectedBulkItemIds: [],
    });
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false);
    });
    expect(update).toHaveBeenNthCalledWith(
      1,
      snapshot.map((change) =>
        change.path === 'quickActions.typeReasoningEffortOverrides'
          ? { path: change.path, value: desired }
          : change,
      ),
    );
    expect(saved.get('quickActions.typeReasoningEffortOverrides')).toEqual(desired);
    expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual(desired);
    await undoSettingsProposalWork(result.reverseChanges);
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
      expect(store.state.backgroundAgentSettings.persistencePending).toBe(false);
    });
    expect(update).toHaveBeenNthCalledWith(2, snapshot);
    expect(list.mock.calls).toEqual([[], []]);
    expect(saved.get('quickActions.typeReasoningEffortOverrides')).toEqual(initial);
    expect(store.state.backgroundAgentSettings.typeReasoningEffortOverrides).toEqual(initial);
  });
}

for (const path of ['model.defaultProvider', 'model.default']) {
  for (const undo of [false, true]) {
    for (const switchFirst of [true, false]) {
      it(`rejects a blocked provider proposal before any changes (${path}, undo ${undo}, switch first ${switchFirst})`, async () => {
        dispose = store.init();
        stopBackground = store.runSaga(backgroundAgentSettingsSaga);
        applySettingsChanges([
          { path: 'model.defaultProvider', value: 'codex' },
          { path: 'quickActions.defaultModel', value: 'balanced' },
          { path: 'quickActions.defaultReasoningEffort', value: 'low' },
          {
            path: 'quickActions.providerSettings',
            value: {
              'claude-code': {
                defaultModel: 'codex:foreign-model',
                typeOverrides: {},
                defaultReasoningEffort: 'medium',
              },
            },
          },
        ]);
        stopSaga = store.runSaga(modelSelectionSaga);
        const before = store.state.backgroundAgentSettings;
        const modelBefore = store.state.model;
        const dispatch = vi.spyOn(store, 'dispatch');
        const changes = [
          { path, value: path === 'model.default' ? 'claude-code:deep' : 'claude-code' },
          { path: 'quickActions.defaultReasoningEffort', value: 'high' },
        ];
        if (!switchFirst) changes.reverse();
        await expect(
          undo
            ? undoSettingsProposalWork(
                changes.map((change) => ({
                  ...change,
                  apply: findAppSettingDefinition(change.path)!.apply,
                })),
              )
            : applySettingsProposalWork({
                proposal: {
                  kind: 'settings-change',
                  applyToolCallId: 'blocked-provider-and-effort',
                  payload: { changes },
                  preview: { title: 'Change provider and effort' },
                },
                editedFields: {},
                selectedBulkItemIds: [],
              }),
        ).rejects.toThrow(/Cannot switch providers/);
        expect(store.state.backgroundAgentSettings).toBe(before);
        expect(store.state.model).toBe(modelBefore);
        expect(dispatch).not.toHaveBeenCalled();
        dispatch.mockRestore();
      });
    }
  }
}
