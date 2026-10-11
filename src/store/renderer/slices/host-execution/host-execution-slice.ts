import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { HostExecutionContext } from '$shared/types/host-execution';

import type { HostExecutionState } from './host-execution-types';
// Compatibility type export for existing Svelte consumers until cutover.
export type { HostExecutionState } from './host-execution-types';

export const hostExecutionConnectionChanged = createAction<[connection: string | null]>(
  'hostExecution/connectionChanged',
);
export const hostExecutionInvalidated = createAction('hostExecution/invalidated');
export const hostExecutionReceived =
  createAction<[connection: string, generation: number, context: HostExecutionContext]>(
    'hostExecution/received',
  );
export const hostExecutionReducer = createReducer<HostExecutionState>({
  connection: null,
  generation: 0,
  context: null,
});
hostExecutionReducer.with(hostExecutionConnectionChanged, (state, { payload: [connection] }) => ({
  connection,
  generation: state.generation + 1,
  context: null,
}));
hostExecutionReducer.with(hostExecutionInvalidated, (state) => ({
  ...state,
  generation: state.generation + 1,
  context: null,
}));
hostExecutionReducer.with(
  hostExecutionReceived,
  (state, { payload: [connection, generation, context] }) =>
    state.connection === connection && state.generation === generation
      ? { ...state, context }
      : state,
);
