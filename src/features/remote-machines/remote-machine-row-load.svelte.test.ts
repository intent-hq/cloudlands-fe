/**
 * @vitest-environment jsdom
 *
 * Settings → runner rows: a connected runner shows its machine-wide agent
 * count (every host's agents and its own); its tooltip has the cap and the
 * host's CPU and memory. A runner that is not connected falls back to this
 * host's agents there.
 */
import { render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { setupMachineOrderFixture } from '../../test/machine-order-preview';
import { setupNodesFixture } from '../../test/nodes-preview';
import MachineLoad from './MachineLoad.svelte';
import { machineLoadFacts } from './remote-machines-messages';
import type { RemoteMachine } from '$shared/types/remote-machines';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function renderState(state: Parameters<typeof setupMachineOrderFixture>[0]) {
  store.init();
  restore = setupMachineOrderFixture(state);
  const view = render(DevicesSettings);
  return view.container.querySelector('[data-machine-order-section]') as HTMLElement;
}

const row = (section: HTMLElement, name: string) =>
  within(section).getByText(name, { selector: 'article *' }).closest('article') as HTMLElement;

describe('runner load on a machine row', () => {
  it("shows a connected runner's machine-wide count with its cap in the tooltip", () => {
    const studio = row(renderState('owner'), 'Studio Mac');
    const load = studio.querySelector('[data-machine-load]') as HTMLElement;
    expect(load.dataset.machineLoad).toBe('4');
    expect(load.textContent).toBe('4 agents running');
    expect(within(studio).queryByText(/CPU/)).toBeNull();
    // Only on the runner row: the Hosts list does not repeat it.
    expect(document.querySelectorAll('[data-machine-load]')).toHaveLength(1);
  });

  it('shows the count at 0 when the runner reports CPU and memory, and lists only the reported facts', () => {
    store.init();
    const machine: RemoteMachine = {
      id: 'd-idle',
      name: 'Idle runner',
      hosts: [],
      port: 1,
      fingerprint: 'EE',
      state: 'connected',
      runningAgents: 0,
      addedAt: '2026-11-01T00:00:00Z',
      capabilities: {
        providers: [],
        capacity: { runningAgents: 0, agentCap: 4 },
        resources: { memoryUsedBytes: 2 * 1024 ** 3, memoryTotalBytes: 16 * 1024 ** 3 },
      },
    };
    const { container } = render(MachineLoad, { props: { machine } });
    expect(container.querySelector('[data-machine-load]')?.textContent).toBe('0 agents running');

    // The limit and memory become name-tooltip facts; no CPU fact when the runner does not report it.
    expect(machineLoadFacts(machine).map((fact) => fact.label)).toEqual([
      m.remoteMachines_details_agents_label(),
      m.remoteMachines_details_memory_label(),
    ]);
  });

  it('shows the count on a saved node runner row (rendered as a device row), not in the Hosts list', () => {
    store.init();
    restore = setupNodesFixture('machines-and-nodes');
    const view = render(DevicesSettings);
    const rig = view.container.querySelector('[data-device-row="gpu-rig"]') as HTMLElement;
    expect(rig.querySelector('[data-machine-load]')?.textContent).toBe('2 agents running');
    expect(view.container.querySelectorAll('[data-machine-load]')).toHaveLength(1);
  });

  it('shows nothing on an older runner with nothing running (no CPU or memory reported)', () => {
    const garage = row(renderState('owner'), 'Garage node');
    expect(garage.querySelector('[data-machine-load]')).toBeNull();
  });
});
