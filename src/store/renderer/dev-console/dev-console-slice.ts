import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { DevConsoleRow, DevConsoleUpdate } from '$shared/types/dev-console';

export interface DevConsoleState {
  update: Omit<DevConsoleUpdate, 'upserts'> | null;
  rows: Record<string, DevConsoleRow>;
  error: string | null;
}
const initial: DevConsoleState = { update: null, rows: {}, error: null };
export const consoleUpdated = createAction<[update: DevConsoleUpdate]>('devConsole/updated');
export const consoleFailed = createAction<[error: string]>('devConsole/failed');
export const consoleReset = createAction('devConsole/reset');
export const devConsoleReducer = createReducer<DevConsoleState>(initial);
devConsoleReducer.with(consoleUpdated, (state, { payload: [update] }) => {
  const sameSession = state.update?.sessionId === update.sessionId;
  if (sameSession && state.update!.revision > update.revision) return state;
  const rows = sameSession ? { ...state.rows } : {};
  for (const row of update.upserts) rows[row.id] = row;
  const live = new Set(update.recordIds);
  for (const id of Object.keys(rows)) if (!live.has(id)) delete rows[id];
  const { upserts: _upserts, ...metadata } = update;
  return { update: metadata, rows, error: null };
});
devConsoleReducer.with(consoleFailed, (state, { payload: [error] }) => ({ ...state, error }));
devConsoleReducer.with(consoleReset, () => initial);
