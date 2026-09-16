import type { SystemStatusWirePayload } from './daemon-health-types';

/**
 * Exactly the `system.status` key set a Collaborator caller receives —
 * intentd `control::collaborator_status_json` (`COLLABORATOR_STATUS_FIELDS` /
 * `COLLABORATOR_STATUS_HOST_FIELDS`, intentd #1934 @ 60de0618). No
 * `clients` / `agents` / `busyAgents` / `maxAgents`, no `transports`, no
 * process / disk telemetry, no `host.hasDisplay`.
 *
 * This module is NOT a `*.test.ts` file, so `pnpm run check` type-checks the
 * literal against `SystemStatusWirePayload`: re-requiring any of the omitted
 * fields on the wire type fails `check`, not just the runtime tests.
 */
export const collaboratorSystemStatusProjection: SystemStatusWirePayload = {
  running: true,
  listenMode: 'both',
  port: 5180,
  version: '0.0.0-test',
  buildCommit: '0123456789abcdef',
  protocolVersion: 'test',
  fingerprint: 'AB:CD',
  hostname: 'studio.local',
  host: {
    os: 'linux',
    arch: 'x86_64',
    locality: 'remote',
  },
};
