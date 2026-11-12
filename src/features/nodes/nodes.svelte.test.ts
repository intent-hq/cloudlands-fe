/**
 * @vitest-environment jsdom
 *
 * Settings → Machines with nodes: the Machines and Nodes lists, node rows, the
 * Add machine menu's Set up a new machine item, and every state of the link field.
 */
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import { NODE_LINK, setupNodesFixture, type NodesPreviewState } from '../../test/nodes-preview';
import PairLinkField from './PairLinkField.svelte';

let restore: (() => void) | null = null;
function seed(state: NodesPreviewState) {
  store.init();
  restore = setupNodesFixture(state);
  vi.spyOn(store, 'dispatch');
}

afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

const dispatched = () =>
  (
    store.dispatch as unknown as { mock: { calls: [{ type: string; payload: unknown[] }][] } }
  ).mock.calls.map(([action]) => action);

const nodesSection = (container: HTMLElement) =>
  container.querySelector('[data-nodes-section]') as HTMLElement | null;

describe('Machines and Nodes', () => {
  it('hides the Nodes section when there are no nodes', () => {
    seed('no-nodes');
    const view = render(DevicesSettings);
    expect(nodesSection(view.container)).toBeNull();
    expect(view.getByText('Studio Mac')).toBeTruthy();
  });

  it('lists nodes only under Nodes, with what each one does for the backend', () => {
    seed('machines-and-nodes');
    const view = render(DevicesSettings);
    const nodes = nodesSection(view.container)!;
    expect(within(nodes).getByText('Nodes only run agents for your backends.')).toBeTruthy();
    const gpu = nodes.querySelector('[data-device-row="gpu-rig"]') as HTMLElement;
    const pi = nodes.querySelector('[data-device-row="pi-node"]') as HTMLElement;
    expect(within(gpu).getByText('Runs agents for Build box')).toBeTruthy();
    expect(within(pi).getByText('Not used by Build box')).toBeTruthy();
    const machines = view.container.querySelector('[aria-label="Machines"]') as HTMLElement;
    expect(within(machines).getByText('Studio Mac')).toBeTruthy();
    expect(within(machines).queryByText('GPU rig')).toBeNull();
  });

  it('keeps nodes out of the machines the backend can run agents on', () => {
    seed('machines-and-nodes');
    const view = render(DevicesSettings);
    const section = view.container.querySelector(
      'section[aria-labelledby="remote-machines-title"]',
    ) as HTMLElement;
    expect(within(section).getByText('Studio Mac')).toBeTruthy();
    expect(within(section).queryByText('GPU rig')).toBeNull();
  });

  it('a node has no Connect, and offers to let the backend run agents there', async () => {
    seed('machines-and-nodes');
    render(DevicesSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions for Garage Pi' }));
    await screen.findByRole('menuitem', { name: 'Let Build box run agents here' });
    expect(screen.queryByRole('menuitem', { name: 'Connect' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeTruthy();
  });

  it('highlights the row that was just added', () => {
    seed('added-machine');
    const view = render(DevicesSettings);
    const row = view.container.querySelector('[data-device-row="lab-pc"]') as HTMLElement;
    expect(row.dataset.highlighted).toBe('true');
    expect(
      view.container
        .querySelector('[data-device-row="studio-mac"]')
        ?.hasAttribute('data-highlighted'),
    ).toBe(false);
  });
});

describe('Add machine menu', () => {
  it('starts with Set up a new machine, which opens the wizard', async () => {
    seed('no-nodes');
    render(DevicesSettings, { initialAddMenuOpen: true });
    await fireEvent.click(await screen.findByTestId('add-machine-setup'));
    expect(dispatched().map((a) => a.type)).toContain('machineSetup/opened');
    expect(screen.queryByTestId('add-machine-paste-link')).toBeNull();
  });
});

describe('link field', () => {
  it('shows the link with its token masked while testing', () => {
    seed('testing');
    const view = render(PairLinkField);
    expect(view.getByText('Testing the link…')).toBeTruthy();
    const masked = view.container.querySelector('[data-pair-link-masked]')!.textContent ?? '';
    expect(masked).toContain('token=••••');
    expect(view.container.textContent).not.toContain('owner-secret-token');
  });

  it.each([
    ['not-a-link', "This isn't an intent:// pair or node link.", false],
    ['wrong-token', 'Run intentd pair --rotate there', false],
    ['labs-off', 'To add GPU rig, turn on Remote agents in Settings → Labs.', false],
    [
      'backend-unsupported',
      "Build box can't run agents on other machines, so GPU rig wasn't added.",
      true,
    ],
  ] as const)('%s shows its error inline', (state, text, retry) => {
    seed(state);
    const view = render(PairLinkField);
    expect(view.getByRole('alert').textContent).toContain(text);
    expect(!!view.queryByRole('button', { name: 'Try again' })).toBe(retry);
  });

  it('lists each route tried when the link is unreachable, then offers Try again', async () => {
    seed('unreachable');
    const view = render(PairLinkField);
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain('192.0.2.20:7443');
    expect(alert.textContent).toContain('tc-gpu-rig');
    await fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(dispatched().map((a) => a.type)).toContain('nodes/pasteLinkRetried');
  });
});
