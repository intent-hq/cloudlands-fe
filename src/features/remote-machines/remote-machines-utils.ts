import { LOCAL_CONNECTION_ID, type ConnectionRecord } from '$shared/types/connections';
import { fingerprintKey, type RemoteMachine } from '$shared/types/remote-machines';

type ConnectionIdentity = Pick<ConnectionRecord, 'id' | 'isLocal' | 'fingerprint'>;

/**
 * The exposed machine for a saved connection, matched by WSS certificate
 * fingerprint: the backend pins the same certificate as the owner
 * connection; this computer's own daemon reports it in `server.pairingInfo`.
 */
export function machineForConnection(
  machines: readonly RemoteMachine[],
  connection: ConnectionIdentity,
  localFingerprint: string | null,
): RemoteMachine | null {
  const key = fingerprintKey(connection.isLocal ? localFingerprint : connection.fingerprint);
  if (!key) return null;
  return machines.find((machine) => fingerprintKey(machine.fingerprint) === key) ?? null;
}

/** The saved connection for an exposed machine, when one of this app's machines matches. */
export function connectionForMachine(
  machine: RemoteMachine,
  connections: readonly ConnectionIdentity[],
  localFingerprint: string | null,
): string | null {
  const key = fingerprintKey(machine.fingerprint);
  if (!key) return null;
  if (fingerprintKey(localFingerprint) === key) return LOCAL_CONNECTION_ID;
  return (
    connections.find(
      (connection) => !connection.isLocal && fingerprintKey(connection.fingerprint) === key,
    )?.id ?? null
  );
}

/** Offer "Let <backend> run agents here" again only while the machine is not usefully exposed. */
export function canOfferExpose(machine: RemoteMachine | null): boolean {
  return !machine || machine.state === 'revoked';
}

/** First executor-link version that runs remote agents' saved scripts. */
const REMOTE_SCRIPTS_LINK_VERSION = 8;

/**
 * The backend runs remote agents' saved scripts (`remoteScripts: 1`) but the
 * machine last bound on an older link, which refuses them: it needs an
 * update. Unknown (never bound) is not flagged.
 */
export function machineNeedsUpdateForScripts(
  machine: Pick<RemoteMachine, 'nodeProtocol'>,
  remoteScriptsSupported: boolean,
): boolean {
  return (
    remoteScriptsSupported &&
    machine.nodeProtocol !== undefined &&
    machine.nodeProtocol < REMOTE_SCRIPTS_LINK_VERSION
  );
}
