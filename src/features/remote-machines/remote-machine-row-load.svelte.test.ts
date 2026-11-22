/**
 * @vitest-environment jsdom
 *
 * Settings → runner rows: a connected runner shows its machine-wide agent
 * count (every host's agents and its own); its tooltip has the cap and the
 * host's CPU and memory. A runner that is not connected falls back to this
 * host's agents there.
 */
import { render, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { setupMachineOrderFixture } from '../../test/machine-order-preview';
import MachineLoad from './MachineLoad.svelte';

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

  it('shows the count at 0 when the runner reports CPU and memory, so the tooltip is reachable', async () => {
    store.init();
    const { container } = render(MachineLoad, {
      props: {
        tooltipOpen: true,
        machine: {
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
        },
      },
    });
    const load = container.querySelector('[data-machine-load]') as HTMLElement;
    expect(load.textContent).toBe('0 agents running');
    const tooltip = await waitFor(() => {
      const shown = document.querySelector<HTMLElement>('[data-machine-load-tooltip]');
      expect(shown).not.toBeNull();
      return shown as HTMLElement;
    });
    expect([...tooltip.children].map((line) => line.textContent)).toEqual([
      "0 of 4 agent slots in use, counting agents from every host and the runner's own",
      '2Gi of 16Gi memory in use',
    ]);
  });

  it('shows nothing on an older runner with nothing running (no CPU or memory reported)', () => {
    const garage = row(renderState('owner'), 'Garage node');
    expect(garage.querySelector('[data-machine-load]')).toBeNull();
  });
});
