import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type { StoreAction, StoreDispatch } from '@themislib/themis/types';
import { call, put, type SagaGenerator } from 'typed-redux-saga';

type SourceScope = { kind: 'source' };
type PrincipalAuthority = {
  /** Read the authoritative snapshot synchronously, never a cached signal/channel value. */
  readCurrentContext: () => string | null;
  /** The host's synchronous Store dispatch; deferred middleware needs a new review. */
  dispatch: StoreDispatch;
};

export type AgentReadAdmission<State> =
  | SourceScope
  | (PrincipalAuthority & {
      kind: 'principal';
      contextSelector: SelectorChannelSelector<string | null, [], State>;
    });

export type AgentReadScope =
  SourceScope | (PrincipalAuthority & { kind: 'principal'; context: string });

export function isAgentReadScopeCurrent(scope: AgentReadScope): boolean {
  return scope.kind === 'source' || scope.readCurrentContext() === scope.context;
}

/** Fence each write at dispatch entry. Previously authorized writes are not rolled back. */
export function* putAgentReadAction(
  scope: AgentReadScope,
  action: StoreAction<unknown>,
): SagaGenerator<boolean> {
  if (scope.kind === 'source') {
    yield* put(action);
    return true;
  }
  return yield* call(() => {
    if (!isAgentReadScopeCurrent(scope)) return false;
    scope.dispatch(action);
    return true;
  });
}
