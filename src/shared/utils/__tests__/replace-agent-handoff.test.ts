import { describe, expect, it } from 'vitest';

import { buildReplaceAgentHandoffMessage } from '../replace-agent-handoff';

describe('buildReplaceAgentHandoffMessage', () => {
  it('interpolates the exact agent name and specialist into the create call', () => {
    const message = buildReplaceAgentHandoffMessage({
      agentName: 'Release Coordinator',
      specialist: 'implementor',
    });

    expect(message).toContain(
      'ws.agent.create("Release Coordinator", kickoffMessage, { topLevel: true, specialist: "implementor" })',
    );
    expect(message).toContain('EXACT current name ("Release Coordinator")');
    expect(message).toContain('keep the same specialist ("implementor")');
  });

  it('omits the specialist option but still asks for specialist parity when unknown', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'Solo Agent' });

    expect(message).toContain('ws.agent.create("Solo Agent", kickoffMessage, { topLevel: true })');
    expect(message).not.toContain('specialist:');
    expect(message).toContain('pass that exact same `specialist` value');
  });

  it('directs a gradual hand-off dialog answered via ws.agent.send', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'A' });

    expect(message).toContain('ws.agent.send');
    expect(message).toContain('gradually instead of all at once');
    expect(message).toContain('invite the replacement to ask questions');
  });

  it('keeps children monitored by the old agent and never transfers them', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'A' });

    expect(message).toContain('Keep monitoring your own in-flight child agents');
    expect(message).toContain('child agents are NOT transferred');
  });

  it('directs re-arming hooks, PR monitors, subscriptions, and watches on the replacement', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'A' });

    expect(message).toContain('ws.hook.*');
    expect(message).toContain('ws.pr.monitor');
    expect(message).toContain('event subscriptions');
    expect(message).toContain('agent watches');
    expect(message).toContain('cancel your own');
  });

  it('requires mutual agreement before retiring via ws.agent.retire', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'A' });

    expect(message).toContain('MUTUALLY agree');
    expect(message).toContain('ws.agent.retire(reason)');
  });

  it('never references the removed spawnPeer API', () => {
    const withSpecialist = buildReplaceAgentHandoffMessage({
      agentName: 'A',
      specialist: 'verifier',
    });
    const withoutSpecialist = buildReplaceAgentHandoffMessage({ agentName: 'A' });

    expect(withSpecialist).not.toContain('spawnPeer');
    expect(withoutSpecialist).not.toContain('spawnPeer');
  });

  it('escapes quotes in agent names so the call shape stays valid', () => {
    const message = buildReplaceAgentHandoffMessage({ agentName: 'The "Fixer"' });

    expect(message).toContain(
      'ws.agent.create("The \\"Fixer\\"", kickoffMessage, { topLevel: true })',
    );
  });
});
