/**
 * @vitest-environment jsdom
 *
 * Settings → "Where <backend> runs agents": rows that can run agents show no
 * status pill (the section title already says it); rows that can't keep theirs.
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
    // One row of each kind: a saved connection, a node, a cloud entry.
    expect(row(section, 'Studio Mac').hasAttribute('data-device-row')).toBe(true);
    expect(row(section, 'Garage node').hasAttribute('data-remote-machine-row')).toBe(true);
    expect(row(section, 'Team project').hasAttribute('data-cloud-machine-row')).toBe(true);
    expect(within(section).queryAllByText(/^Runs agents for/)).toHaveLength(0);
    expect(within(row(section, 'Studio Mac')).queryByText(/Runs agents for/)).toBeNull();
    expect(within(row(section, 'Team project')).queryByText(/Runs agents for/)).toBeNull();
  });

  it('keeps the ready cloud entry status for assistive tech on its dot', () => {
    const section = renderOrdered('owner');
    expect(
      within(row(section, 'Team project')).getByRole('img', { name: /^Runs agents for/ }),
    ).toBeTruthy();
  });

  it('keeps every exception pill', () => {
    const section = renderOrdered('exceptions');
    expect(within(row(section, 'Studio Mac')).getByText('Update required')).toBeTruthy();
    expect(within(row(section, 'Garage node')).getByText('Unreachable')).toBeTruthy();
    expect(within(row(section, 'Team project')).getByText('Key rejected')).toBeTruthy();
  });
});

describe('machine status pills in the Nodes list', () => {
  it('shows "Not used by" but no "Runs agents for" pill', () => {
    store.init();
    restore = setupNodesFixture('machines-and-nodes');
    const view = render(DevicesSettings);
    const nodes = view.container.querySelector('[data-nodes-section]') as HTMLElement;
    expect(within(nodes).queryByText('Runs agents for Build box')).toBeNull();
    expect(within(nodes).getByText('Not used by Build box')).toBeTruthy();
  });
});
