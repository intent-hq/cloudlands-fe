/**
 * The `client.hello` capabilities a backend transport passes to the renderer.
 *
 * Both transports (Electron main's `JsonRpcClient`, answering
 * `BACKEND.NODE_CAPABILITIES`, and the browser WebSocket transport) copy the
 * acknowledged hello through this one list, and the renderer reads it with
 * `observeBackendNodeCapabilities()`. A capability left off the list always
 * reads as absent in the renderer, whatever the daemon advertises: the
 * New Workspace Start On row never showed because `remoteInitialAgent` was
 * missing here (intent-hq/intent#8423). `node-capabilities.test.ts` fails when
 * a renderer consumer gates on a key that is not listed.
 *
 * Main-process and renderer safe: no imports, no side effects.
 */
export const NODE_CAPABILITY_KEYS = [
  'agentNodes',
  'localNodeIsolation',
  'agentPlatformRouting',
  'workspaceMembershipEvents',
  // Dock evidence placement.
  'rawScreenshotRetention',
  'chiefAttachments',
  // Truncated note reads (§5.2): gates maxContentBytes / baseContentBytes.
  'noteTruncatedRead',
  // Daemon-to-daemon remote machines: gates "Let <backend> run agents here".
  'remoteMachines',
  // `workspace.create.initialAgent.placement` on a remote machine: gates Start On.
  'remoteInitialAgent',
  // `remoteMachines.claim`: gates adding a machine from an intent://node link.
  'remoteMachineClaim',
  // Owner-only daemon-link traffic capture: gates the Dev Console "Daemon links" view.
  'remoteLinkTraffic',
  // E2B cloud machines: gates Settings → Machines → E2B and the Start On E2B row.
  'cloudMachines',
  // Named E2B entries: gates entries under Nodes and `cloudMachineId` in placements.
  'cloudMachineEntries',
  'cloudMachineProviders',
] as const;

type NodeCapabilityKey = (typeof NODE_CAPABILITY_KEYS)[number];

/** Each listed capability as 1 when advertised, else 0. */
export type NodeCapabilitySnapshot = Readonly<Record<NodeCapabilityKey, 0 | 1>>;

/**
 * Copy the listed capabilities from a hello's `server.capabilities`. Only the
 * strict integer advertisement `1` enables one; anything else is absent.
 */
export function pickNodeCapabilities(
  capabilities: Record<string, unknown> | null | undefined,
): NodeCapabilitySnapshot {
  return Object.freeze(
    Object.fromEntries(NODE_CAPABILITY_KEYS.map((key) => [key, capabilities?.[key] === 1 ? 1 : 0])),
  ) as NodeCapabilitySnapshot;
}
