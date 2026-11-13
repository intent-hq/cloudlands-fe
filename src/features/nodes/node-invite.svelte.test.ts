/**
 * @vitest-environment jsdom
 *
 * Settings → Machines after an `intent://node` link: the claimed machine is
 * listed under Nodes with Stop, and the paste row shows each invite failure.
 */
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import {
  NODE_INVITE_SECRET,
  setupNodesFixture,
  type NodesPreviewState,
} from '../../test/nodes-preview';
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

describe('a machine added from a node link', () => {
  it('is listed under Nodes, highlighted, and not as a machine of the backend', () => {
    seed('invite-claimed');
    const view = render(DevicesSettings);
    const nodes = view.container.querySelector('[data-nodes-section]') as HTMLElement;
    const row = nodes.querySelector('[data-remote-machine-row="d-lab-node"]') as HTMLElement;
    expect(within(row).getByText('Lab node')).toBeTruthy();
    expect(within(row).queryByText('Runs agents for Build box')).toBeNull();
    expect(row.dataset.highlighted).toBe('true');
    expect(
      view.container.querySelector('section[aria-labelledby="remote-machines-title"]'),
    ).toBeNull();
  });

  it('Stop letting the backend run agents there removes it from the backend only', async () => {
    seed('invite-claimed');
    render(DevicesSettings);
    await fireEvent.click(screen.getByRole('button', { name: 'Actions for Lab node' }));
    await fireEvent.click(
      await screen.findByRole('menuitem', {
        name: 'Stop letting Build box run agents on this machine',
      }),
    );
    expect(
      dispatched().find((a) => a.type === 'remoteMachines/unexposeRequested')?.payload,
    ).toEqual(['d-lab-node', null]);
  });
});

describe('link field with a node link', () => {
  it('masks the invite secret while the backend claims it', () => {
    seed('invite-claiming');
    const view = render(PairLinkField);
    const masked = view.container.querySelector('[data-pair-link-masked]')!.textContent ?? '';
    expect(masked).toContain('secret=••••');
    expect(view.container.textContent).not.toContain(NODE_INVITE_SECRET);
  });

  it.each([
    ['invite-used', 'This link was already used. Run intentd pair --node on Lab node', false],
    ['invite-expired', 'This link has expired. Run intentd pair --node on Lab node', false],
    ['invite-revoked', 'This link was revoked on Lab node.', false],
    ['invite-invalid', "Lab node didn't accept this link.", false],
    ['link-version', 'This link needs a newer version of Intent.', false],
    ['invite-not-owner', 'Only the owner of Build box can add machines to it.', false],
    ['invite-update-required', 'Lab node needs an update', false],
    ['invites-unsupported', "Build box can't add machines from intent://node links yet.", true],
    ['invite-labs-off', 'To add Lab node, turn on Remote agents in Settings → Labs.', false],
    ['invite-self', "This link is for Build box's own machine", false],
    ['invite-certificate', "Lab node's certificate doesn't match this link.", false],
    ['invite-unreachable-spent', 'this link may be used up', false],
  ] as const)('%s shows its error inline', (state, text, retry) => {
    seed(state);
    const view = render(PairLinkField);
    expect(view.getByRole('alert').textContent).toContain(text);
    expect(!!view.queryByRole('button', { name: 'Try again' })).toBe(retry);
  });

  it('lists the routes the backend tried, then offers Try again', async () => {
    seed('invite-unreachable');
    const view = render(PairLinkField);
    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain("Build box couldn't reach Lab node. Tried:");
    expect(alert.textContent).toContain('192.0.2.40:7443');
    await fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(dispatched().map((a) => a.type)).toContain('nodes/pasteLinkRetried');
  });
});
