/**
 * Audit 2 C2 / C3 — Static regression tests for workspace-event emission sites
 * in `agent-backend-handler.service.ts`.
 *
 * The six lifecycle emit sites (`agent:idle`, `agent:created`, `agent:deleted`,
 * `agent:restored`, `agent:started`, `agent:failed`) used to build raw event
 * literals inline, bypassing `createWorkspaceEvent` and the `WorkspaceEvent`
 * discriminated union. C2 converted all six to use `createWorkspaceEvent`.
 *
 * The four queue events (`agent:queue:updated`, `agent:queue:processing`,
 * `agent:queue:processing-cancelled`, `agent:queue:stale-message`) flow through
 * the typed `emitQueueWorkspaceEvent` helper; C3 added stale-message coverage
 * and tightened the helper signature so the `as any` cast on the event-type
 * argument is no longer needed.
 *
 * These tests scan the source file directly so they remain valid even though
 * the service has no behavioural unit-test harness yet.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const HANDLER_PATH = path.join(
  __dirname,
  '..',
  'agent-backend-handler.service.ts',
);
const SOURCE = readFileSync(HANDLER_PATH, 'utf-8');

describe('Audit 2 C2 — agent-backend-handler lifecycle emissions', () => {
  it('does not contain raw-literal reduxEmitWorkspaceEvent({ ... type: ... }) calls', () => {
    // Raw literals like `reduxEmitWorkspaceEvent({ id: ..., type: 'agent:idle', ...})`
    // bypass createWorkspaceEvent. Match the helper-call form `reduxEmitWorkspaceEvent({`
    // (an opening brace on the same line) and assert there are zero remaining
    // occurrences in the file.
    const rawLiteralPattern = /reduxEmitWorkspaceEvent\(\s*\{/g;
    const matches = SOURCE.match(rawLiteralPattern) ?? [];
    expect(matches.length).toBe(0);
  });

  const expectedTypes = [
    'agent:idle',
    'agent:created',
    'agent:deleted',
    'agent:restored',
    'agent:started',
    'agent:failed',
  ];

  it.each(expectedTypes)(
    'emits %s via createWorkspaceEvent (not as a raw literal)',
    (eventType) => {
      // For every lifecycle event type we expect a call site like
      //   reduxEmitWorkspaceEvent(createWorkspaceEvent('agent:idle', ...
      // — the helper preserves typed union narrowing and uniform actor
      // normalization.
      const pattern = new RegExp(
        `reduxEmitWorkspaceEvent\\(createWorkspaceEvent\\(\\s*'${eventType}'`,
      );
      expect(SOURCE).toMatch(pattern);
    },
  );
});

describe('Audit 2 C3 — agent-backend-handler queue emissions', () => {
  it('routes agent:queue:stale-message through emitQueueWorkspaceEvent', () => {
    // C3 made stale-message a workspace event in addition to the existing
    // sendToRenderer IPC channel. The handler must call the helper with the
    // exact event-type string.
    expect(SOURCE).toMatch(
      /emitQueueWorkspaceEvent\(\s*'agent:queue:stale-message'/,
    );
  });

  it('emitQueueWorkspaceEvent parameter is typed (no `eventType as any` cast)', () => {
    // Tightening the helper signature removed the `eventType as any` cast.
    // Make sure no regression reintroduces it.
    expect(SOURCE).not.toMatch(/emitQueueWorkspaceEvent[\s\S]{0,200}eventType\s+as\s+any/);
  });

  it('still keeps the IPC `agent:queue:stale-message` renderer notification', () => {
    // The IPC `sendToRenderer('agent:queue:stale-message', ...)` path is
    // preserved so existing renderer code keeps working.
    expect(SOURCE).toMatch(
      /sendToRenderer\(\s*'agent:queue:stale-message'/,
    );
  });
});
