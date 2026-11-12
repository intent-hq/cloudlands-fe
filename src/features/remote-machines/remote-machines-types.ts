import type {
  ExecutorBackend,
  MachineOrderRow,
  RemoteMachine,
  RemoteMachineFailure,
} from '$shared/types/remote-machines';

/** One pending operation per key: a saved connection id (expose), machine id (remove) or credential id (revoke). */
export type RemoteMachineOperation = 'exposing' | 'removing' | 'revoking' | 'refreshing';

export interface RemoteMachinesState {
  /** `client.hello` on the current backend advertises `remoteMachines: 1`. */
  supported: boolean;
  /**
   * `client.hello` also advertises `remoteInitialAgent: 1`: `workspace.create`
   * accepts `initialAgent.placement`. Older backends may ignore the field.
   */
  initialAgentPlacement: boolean;
  /** `client.hello` also advertises the node-invite claim capability (`intent://node` links). */
  claimInvites: boolean;
  /** `client.hello` also advertises `machineOrder: 1`: one user-ordered machine list. */
  machineOrder: boolean;
  /**
   * `remoteMachines.order` (first = preferred); null until read or without
   * `machineOrder: 1`. Owner reorders replace it optimistically.
   */
  order: MachineOrderRow[] | null;
  /**
   * The id of the `remoteMachines.setOrder` in flight, or null. Further moves
   * wait for it, and only that save (or a new connection) settles it.
   */
  orderSaving: string | null;
  /** The current backend's exposed machines, keyed by machine (daemon) id. */
  machines: Record<string, RemoteMachine>;
  /** WSS certificate fingerprint of this computer's own daemon, to match its row. */
  localFingerprint: string | null;
  /** Backends the current backend's own machine is available to (`executor.list`); null when unavailable. */
  executorBackends: ExecutorBackend[] | null;
  pending: Record<string, RemoteMachineOperation>;
  /** Last failure per key (connection id for expose, machine id for remove, credential id for revoke). */
  failures: Record<string, RemoteMachineFailure>;
}
