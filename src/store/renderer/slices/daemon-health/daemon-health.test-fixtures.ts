import type { SystemStatusWirePayload } from './daemon-health-types';

/**
 * Exactly the `system.status` key set a Collaborator caller receives —
 * intentd `control::collaborator_status_json` (`COLLABORATOR_STATUS_FIELDS` /
 * `COLLABORATOR_STATUS_HOST_FIELDS`, intentd #1934 @ 60de0618): 12 top-level
 * keys (`running`, `listenMode`, `port`, `version`, `buildCommit`,
 * `protocolVersion`, `fingerprint`, `localIps`, `tcAddress`, `hostname`,
 * `prettyHostname`, `host`) and 5 `host` keys (`os`, `arch`, `locality`,
 * `deviceKind`, `hardwareModel`). No `clients` / `agents` / `busyAgents` /
 * `maxAgents`, no `transports`, no process / disk telemetry, no
 * `host.hasDisplay`.
 *
 * The raw literal carries the full 12/5 set as serialized by the daemon;
 * `localIps`, `tcAddress`, `prettyHostname`, `host.deviceKind` and
 * `host.hardwareModel` are not modelled by `SystemStatusWirePayload`, so it
 * is assigned to the typed export in a second step (a direct annotated
 * literal would fail on excess properties, not on the omissions we care
 * about).
 *
 * This module is NOT a `*.test.ts` file, so `pnpm run check` type-checks the
 * assignment against `SystemStatusWirePayload`: re-requiring any of the
 * omitted fields on the wire type fails `check`, not just the runtime tests.
 */
const rawCollaboratorSystemStatusProjection = {
  running: true,
  listenMode: 'both',
  port: 5180,
  version: '0.0.0-test',
  buildCommit: '0123456789abcdef',
  protocolVersion: 'test',
  fingerprint: 'AB:CD',
  localIps: ['192.0.2.10'],
  tcAddress: null,
  hostname: 'studio.local',
  prettyHostname: 'Studio',
  host: {
    os: 'linux',
    arch: 'x86_64',
    locality: 'remote' as const,
    deviceKind: 'desktop',
    hardwareModel: 'Generic x86_64',
  },
};

export const collaboratorSystemStatusProjection: SystemStatusWirePayload =
  rawCollaboratorSystemStatusProjection;
