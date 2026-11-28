/**
 * @vitest-environment jsdom
 *
 * Settings → "Where <backend> runs agents": a remote machine row shows
 * connection status and reports when no providers can run.
 */
import { render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { setupMachineOrderFixture } from '../../test/machine-order-preview';
import { machineRowNeedsNode } from './machine-facts';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function renderDisconnected() {
  store.init();
  restore = setupMachineOrderFixture('disconnected');
  const view = render(DevicesSettings);
  return view.container.querySelector('[data-machine-order-section]') as HTMLElement;
}

const row = (section: HTMLElement, name: string) =>
  within(section).getByText(name, { selector: 'article *' }).closest('article') as HTMLElement;

describe('remote machine rows while disconnected', () => {
  it('omits the version and availability warning when the last report has runnable providers', () => {
    const garage = row(renderDisconnected(), 'Garage node');
    expect(within(garage).queryByText('0.11.197')).toBeNull();
    expect(within(garage).queryByText('No providers ready')).toBeNull();
  });

  it('says Node.js is needed when some providers would run once it is installed', () => {
    const cache = row(renderDisconnected(), 'Cache box');
    expect(within(cache).getByText('Needs Node.js')).toBeTruthy();
    expect(within(cache).queryByText('No providers ready')).toBeNull();
  });

  it('says so on the runner row of a saved host too', () => {
    const studio = row(renderDisconnected(), 'Studio Mac');
    expect(studio.hasAttribute('data-remote-machine-row')).toBe(true);
    expect(within(studio).getByText('No providers ready')).toBeTruthy();
  });

  it('omits the provider availability warning on cloud rows', () => {
    const cloud = row(renderDisconnected(), 'Team project');
    expect(within(cloud).queryByText('No providers ready')).toBeNull();
  });
});

describe('runner status and platforms in the ordered list', () => {
  function renderState(state: Parameters<typeof setupMachineOrderFixture>[0]) {
    store.init();
    restore = setupMachineOrderFixture(state);
    const view = render(DevicesSettings);
    return view.container.querySelector('[data-machine-order-section]') as HTMLElement;
  }
  const dot = (element: HTMLElement) =>
    element.querySelector('[data-remote-machine-dot]') as HTMLElement;

  it('shows the on-demand status for an idle runner', () => {
    const garage = row(renderState('disconnected'), 'Garage node');
    expect(within(garage).getByText(m.remoteMachines_state_connectsOnDemand_label())).toBeTruthy();
    expect(within(garage).queryByText(m.settings_devices_statusDisconnected_label())).toBeNull();
  });

  it('shows the failure status when a runner is unreachable', () => {
    const garage = row(renderState('exceptions'), 'Garage node');
    expect(dot(garage)).toBeNull();
    expect(within(garage).getByText(m.remoteMachines_state_unreachable_label())).toBeTruthy();
    expect(within(garage).queryByText(m.remoteMachines_state_connectsOnDemand_label())).toBeNull();
  });

  it('shows the Linux platform on a cloud entry', () => {
    const team = row(renderState('owner'), 'Team project');
    expect(within(team).getByRole('img', { name: 'Linux' })).toBeTruthy();
    expect(within(team).queryByText(/vCPU/)).toBeNull();
  });
});

describe('machineRowNeedsNode', () => {
  const machine = (state: string, providers: { id: string; status: string; visible?: false }[]) =>
    ({
      id: 'm',
      name: 'm',
      hosts: [],
      port: 1,
      fingerprint: 'f',
      state,
      runningAgents: 0,
      addedAt: '2026-11-01T00:00:00Z',
      capabilities: { providers: providers.map((p) => ({ ...p, models: [] })) },
    }) as unknown as Parameters<typeof machineRowNeedsNode>[0];
  const name = (id: string) => ({ pi: 'Pi', codex: 'Codex' })[id];

  it('names the visible providers that only lack Node.js', () => {
    expect(
      machineRowNeedsNode(
        machine('disconnected', [
          { id: 'pi', status: 'prerequisite-missing' },
          { id: 'codex', status: 'prerequisite-missing', visible: false },
          { id: 'grok', status: 'cli-missing' },
          { id: 'claude', status: 'signed-in' },
        ]),
        name,
      ),
    ).toEqual(['Pi']);
  });

  it('is empty for an orchestrator, whose provider report is empty by design', () => {
    const report = machine('disconnected', [{ id: 'pi', status: 'prerequisite-missing' }]);
    expect(machineRowNeedsNode(report, name, 'orchestrator')).toEqual([]);
    expect(machineRowNeedsNode(report, name, 'regular')).toEqual(['Pi']);
  });

  it('is empty without a usable report', () => {
    expect(machineRowNeedsNode(null, name)).toEqual([]);
    expect(
      machineRowNeedsNode(machine('revoked', [{ id: 'pi', status: 'prerequisite-missing' }]), name),
    ).toEqual([]);
  });
});
