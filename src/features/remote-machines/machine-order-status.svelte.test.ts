/**
 * @vitest-environment jsdom
 *
 * Settings runner rows expose connection failures with accessible warning icons.
 */
import { render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import {
  setupMachineOrderFixture,
  type MachineOrderPreviewState,
} from '../../test/machine-order-preview';
import { setupNodesFixture } from '../../test/nodes-preview';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function renderOrdered(state: MachineOrderPreviewState) {
  store.init();
  restore = setupMachineOrderFixture(state);
  const view = render(DevicesSettings);
  const section = view.container.querySelector('[data-machine-order-section]') as HTMLElement;
  expect(section).toBeTruthy();
  return section;
}

const row = (section: HTMLElement, name: string) =>
  within(section).getByText(name, { selector: 'article *' }).closest('article') as HTMLElement;

describe('machine status pills in the ordered list', () => {
  it('shows no "Runs agents for" pill on rows that can run agents', () => {
    const section = renderOrdered('owner');
    // One row of each kind: a saved host (its runner row is a plain one), a node, a cloud entry.
    expect(row(section, 'Studio Mac').hasAttribute('data-remote-machine-row')).toBe(true);
    expect(row(section, 'Garage node').hasAttribute('data-remote-machine-row')).toBe(true);
    expect(row(section, 'Team project').hasAttribute('data-cloud-machine-row')).toBe(true);
    expect(within(section).queryAllByText(/^Runs agents for/)).toHaveLength(0);
    expect(within(row(section, 'Studio Mac')).queryByText(/Runs agents for/)).toBeNull();
    expect(within(row(section, 'Team project')).queryByText(/Runs agents for/)).toBeNull();
  });

  it('gives a ready cloud runner no status dot', () => {
    const section = renderOrdered('owner');
    expect(
      within(row(section, 'Team project')).queryByRole('img', { name: /^Runs agents for/ }),
    ).toBeNull();
  });

  it('identifies runner connection problems and cloud failures', () => {
    const section = renderOrdered('exceptions');
    expect(
      within(row(section, 'Studio Mac')).getByRole('img', { name: 'Update required' }),
    ).toBeTruthy();
    expect(
      within(row(section, 'Garage node')).getByRole('img', { name: 'Unreachable' }),
    ).toBeTruthy();
    expect(within(row(section, 'Team project')).getByText('Key rejected')).toBeTruthy();
  });
});

describe('machine status pills in the Nodes list', () => {
  it('shows neither "Not used by" nor "Runs agents for" pills', () => {
    store.init();
    restore = setupNodesFixture('machines-and-nodes');
    const view = render(DevicesSettings);
    const nodes = view.container.querySelector('[data-nodes-section]') as HTMLElement;
    expect(within(nodes).queryByText('Runs agents for Build box')).toBeNull();
    expect(within(nodes).queryByText('Not used by Build box')).toBeNull();
  });
});
