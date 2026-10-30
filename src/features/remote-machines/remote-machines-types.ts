import type {
  ExecutorBackend,
  RemoteMachine,
  RemoteMachineFailure,
} from '$shared/types/remote-machines';

/** One pending operation per key: a saved connection id (expose), machine id (remove) or credential id (revoke). */
export type RemoteMachineOperation = 'exposing' | 'removing' | 'revoking';

export interface RemoteMachinesState {
  /** `client.hello` on the current backend advertises `remoteMachines: 1`. */
  supported: boolean;
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
