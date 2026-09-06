import { describe, expect, it } from 'vitest';
import {
  createSemanticMapScript,
  SCRIPT_AGENTS,
  SCRIPT_DURATION_MINUTES,
  SCRIPT_START,
} from './semantic-map-script';

describe('semantic map sandbox script', () => {
  it('produces deterministic real workspace events across the full replay window', () => {
    const script = createSemanticMapScript();
    expect(script.workspaceEvents).toHaveLength(SCRIPT_DURATION_MINUTES + 1);
    expect(script.workspaceEvents[0]).toMatchObject({
      timestamp: SCRIPT_START,
      type: 'agent:tool:call',
      data: { toolKind: 'file', status: 'completed' },
    });
    expect(script.workspaceEvents.at(-1)?.timestamp).toBe('2026-09-06T10:20:00.000Z');
    expect(new Set(script.workspaceEvents.map(({ actor }) => actor.id))).toEqual(
      new Set(SCRIPT_AGENTS.map(({ id }) => id)),
    );
  });

  it('projects every scripted event and supplies a route for each agent', () => {
    const script = createSemanticMapScript();
    expect(script.activities).toHaveLength(script.workspaceEvents.length);
    expect(new Set(script.activities.map(({ kind }) => kind))).toEqual(
      new Set(['read', 'edit', 'tool', 'thinking']),
    );
    expect(Object.keys(script.routes)).toEqual(SCRIPT_AGENTS.map(({ id }) => id));
    expect(script.routes['agent-daemon'].transitions[0].label).toBe(
      'ACP updates become agent lifecycle and activity events',
    );
  });
});
