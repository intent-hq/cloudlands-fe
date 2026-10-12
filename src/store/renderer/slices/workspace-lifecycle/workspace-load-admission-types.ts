import type { StoreSelectorSelect } from '@themislib/themis/types';
import type { Workspace } from '$shared/types';
import type { WorkspacesClient } from '$lib/client/workspaces-client-types';
import type { AgentReadAdmission } from '../workspace-agents/sagas/agent-read-admission';
import type { WorkspaceDomainClient } from '../workspace/utils/workspace-domain-client-types';
import type { WorkspaceLoadState } from './workspace-lifecycle-types';
import type { workspaceLoadRequested } from './workspace-lifecycle-slice';

export type WorkspaceLoadClients = {
  workspaceClient: Pick<WorkspaceDomainClient, 'open'>;
  appClient: { readonly workspaces: Pick<WorkspacesClient, 'get'> };
};

/**
 * Proposed host port, not an existing product binding. Both actual canonical
 * clients and their transports must belong to this request/authority; a new
 * wrapper around shared pending open/get promises does not establish provenance.
 * Legacy open is local-pinned and error-folding; this port does not repair that
 * routing or replace enriched open with raw get. Real host/client work must
 * establish route alignment before activation.
 */
export type WorkspaceLoadReadScope = WorkspaceLoadClients & {
  readonly requestIdentity: object;
  readonly context: string;
  readonly signal: AbortSignal;
  /** Synchronous; once false, always false, including same-context replacement. */
  isCurrent(): boolean;
  /** Synchronous, non-throwing, idempotent; releases only this acquisition. */
  release(): void;
};

export type WorkspaceLoadRequestLifetime = {
  readonly identity: object;
  readonly workspaceId: string;
  readonly signal: AbortSignal;
  /**
   * The actual originating tab/session/connection ownership, not current focus
   * or a workspace-id generation invented by the loader. Retirement is permanent
   * and signals abort, including null-to-null replacement and same-id reopen.
   */
  isCurrent(): boolean;
  /**
   * Synchronous and non-throwing; no reads or dispatch. A null return is terminal
   * refusal, never readiness waiting. The host must provide this by admission or
   * define genuine wake semantics in a separately reviewed binding. An acquired
   * scope is released once even when its identity/context/currentness is rejected.
   */
  acquireReadScope(context: string): WorkspaceLoadReadScope | null;
};

type PrincipalAdmission<State> = Extract<AgentReadAdmission<State>, { kind: 'principal' }> & {
  /**
   * Synchronously attest the ORIGINATING accepted intent's real ownership, before
   * any wait or deduplication. Never relabel a queued old action with today's host
   * identity. No existing unversioned producer is claimed compatible. Capturing
   * an invalid origin returns null; duplicate captures allocate no resource.
   */
  captureRequest(
    action: ReturnType<typeof workspaceLoadRequested>,
  ): WorkspaceLoadRequestLifetime | null;
};

type WorkspaceLoadSelectors<State> = {
  selectWorkspaceById: {
    select: StoreSelectorSelect<Workspace | undefined, [wsId: string], State>;
  };
  selectIsWorkspaceSessionLive: { select: StoreSelectorSelect<boolean, [wsId: string], State> };
  selectWorkspaceLoadState: {
    select: StoreSelectorSelect<WorkspaceLoadState, [wsId: string], State>;
  };
};

export type WorkspaceLoadOptions<State> = WorkspaceLoadSelectors<State> &
  (
    | (WorkspaceLoadClients & { admission: { kind: 'source' } })
    | {
        admission: PrincipalAdmission<State>;
        workspaceClient?: never;
        appClient?: never;
      }
  );
