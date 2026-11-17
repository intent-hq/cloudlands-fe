/**
 * Where onboarding's first agent can run. On an orchestrator agents run only
 * on the ordered machine list; an empty list fails `workspace.create` with
 * `placement-unavailable` reason `no-agent-machine` (PROTOCOL
 * `methods/nodes.md` → "Orchestrator mode").
 */
import { describe, expect, it } from 'vitest';
import type { MachineOrderRow } from '$shared/types/remote-machines';
import { onboardingAgentMachines } from './onboarding-agent-machines';

const machine: MachineOrderRow = { kind: 'machine', nodeId: 'n1', name: 'Studio' };
const cloud: MachineOrderRow = { kind: 'cloud', cloudMachineId: 'e2b', name: 'E2B' };

describe('onboardingAgentMachines', () => {
  it('is "backend" on a Full daemon, whatever the list says', () => {
    expect(onboardingAgentMachines({ orchestrator: false, order: null })).toBe('backend');
    expect(onboardingAgentMachines({ orchestrator: false, order: [] })).toBe('backend');
  });

  it('is "unknown" on an orchestrator whose list was not read', () => {
    expect(onboardingAgentMachines({ orchestrator: true, order: null })).toBe('unknown');
  });

  it('is "none" on an orchestrator with an empty list', () => {
    expect(onboardingAgentMachines({ orchestrator: true, order: [] })).toBe('none');
    // An orchestrator's list has no "This computer" row; never count one.
    expect(
      onboardingAgentMachines({ orchestrator: true, order: [{ kind: 'local', name: 'Here' }] }),
    ).toBe('none');
  });

  it('is "machines" on an orchestrator with a machine or a cloud entry', () => {
    expect(onboardingAgentMachines({ orchestrator: true, order: [machine] })).toBe('machines');
    expect(onboardingAgentMachines({ orchestrator: true, order: [cloud] })).toBe('machines');
  });
});
