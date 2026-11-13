/**
 * @vitest-environment jsdom
 *
 * Settings → "Where <backend> runs agents": a remote machine row shows the
 * providers of its last report also while it is disconnected (its normal idle
 * state), and a short note when none of them can run.
 */
import { render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { setupMachineOrderFixture } from '../../test/machine-order-preview';

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

const providerNames = (element: HTMLElement) =>
  within(element)
    .queryAllByRole('img')
    .map((icon) => icon.getAttribute('aria-label'))
    .filter((label) => label && !['macOS', 'Linux', 'Windows'].includes(label));

describe('remote machine rows while disconnected', () => {
  it('shows the runnable providers of the last report, without its version', () => {
    const garage = row(renderDisconnected(), 'Garage node');
    expect(garage.hasAttribute('data-remote-machine-row')).toBe(true);
    const providers = within(garage).getByRole('list', { name: 'Available AI providers' });
    const names = providerNames(providers);
    expect(names).toHaveLength(2);
    expect(names.some((name) => /claude/i.test(name!))).toBe(true);
    expect(names.some((name) => /unsloth/i.test(name!))).toBe(true);
    expect(names.some((name) => /grok/i.test(name!))).toBe(false);
    expect(names.some((name) => /cortex/i.test(name!))).toBe(false);
    expect(within(garage).queryByText('0.11.197')).toBeNull();
    expect(
      garage.querySelector('[data-remote-machine-dot="disconnected"]')?.getAttribute('aria-label'),
    ).toBeTruthy();
    expect(within(garage).queryByText('No providers ready')).toBeNull();
  });

  it('says Node.js is needed when that is why no provider can run', () => {
    const cache = row(renderDisconnected(), 'Cache box');
    expect(within(cache).queryByRole('list', { name: 'Available AI providers' })).toBeNull();
    expect(within(cache).getByText('Needs Node.js')).toBeTruthy();
    expect(within(cache).queryByText('No providers ready')).toBeNull();
  });

  it('says so on a saved machine row too', () => {
    const studio = row(renderDisconnected(), 'Studio Mac');
    expect(studio.hasAttribute('data-device-row')).toBe(true);
    expect(within(studio).queryByRole('list', { name: 'Available AI providers' })).toBeNull();
    expect(within(studio).getByText('No providers ready')).toBeTruthy();
  });

  it('adds no "Disconnected" pill', () => {
    const section = renderDisconnected();
    expect(within(row(section, 'Garage node')).queryByText(/disconnected/i)).toBeNull();
  });

  it('leaves cloud rows unchanged', () => {
    const cloud = row(renderDisconnected(), 'Team project');
    expect(within(cloud).queryByRole('list', { name: 'Available AI providers' })).toBeNull();
    expect(within(cloud).queryByText('No providers ready')).toBeNull();
  });
});

describe('status dots and platforms in the ordered list', () => {
  function renderState(state: Parameters<typeof setupMachineOrderFixture>[0]) {
    store.init();
    restore = setupMachineOrderFixture(state);
    const view = render(DevicesSettings);
    return view.container.querySelector('[data-machine-order-section]') as HTMLElement;
  }
  const dot = (element: HTMLElement) =>
    element.querySelector('[data-remote-machine-dot]') as HTMLElement;

  it('greys a machine without a live link and names the state', () => {
    const garage = row(renderState('disconnected'), 'Garage node');
    expect(dot(garage).dataset.remoteMachineDot).toBe('disconnected');
    expect(dot(garage).getAttribute('aria-label')).toMatch(/disconnected/i);
  });

  it('colours a problem and leaves its name to the badge', () => {
    const garage = row(renderState('exceptions'), 'Garage node');
    expect(dot(garage).dataset.remoteMachineDot).toBe('unreachable');
    expect(dot(garage).getAttribute('aria-hidden')).toBe('true');
    expect(within(garage).getByText('Unreachable')).toBeTruthy();
  });

  it('shows the Linux platform on a cloud entry', () => {
    const team = row(renderState('owner'), 'Team project');
    expect(within(team).getByRole('img', { name: 'Linux' })).toBeTruthy();
    expect(within(team).queryByText(/vCPU/)).toBeNull();
  });
});
