/**
 * @vitest-environment jsdom
 *
 * ListenTargetSelector — the listen-target picker (bind IPs; the tailcat
 * tunnel is toggled by the parent, mirrored in via `tunnelSelected`). Covers
 * the selection semantics the Advanced page persists from: exclusive
 * all-interfaces (which locks the covered addresses checked while selected),
 * the never-zero-targets guard, and the loopback lock while the tunnel is on
 * (the tailcat sidecar forwards to 127.0.0.1, so loopback must stay bound).
 */
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import ListenTargetSelector from '../ListenTargetSelector.svelte';

function renderSelector(props: Partial<Parameters<typeof render>[1]> & Record<string, unknown>) {
  const onchange = vi.fn();
  const utils = render(ListenTargetSelector, {
    props: {
      availableIps: ['192.168.1.10', '10.0.0.5'],
      selectedIps: ['192.168.1.10'],
      tunnelSelected: false,
      onchange,
      ...props,
    },
  });
  return { ...utils, onchange };
}

const asButton = (el: HTMLElement): HTMLButtonElement => el as HTMLButtonElement;
const isPressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true';

describe('ListenTargetSelector', () => {
  it('renders available IPs with the bound ones checked, plus all-interfaces', () => {
    const { getByRole } = renderSelector({});
    expect(
      isPressed(getByRole('button', { name: m.settings_listenTargets_allInterfaces_label() })),
    ).toBe(false);
    expect(isPressed(getByRole('button', { name: '192.168.1.10' }))).toBe(true);
    expect(isPressed(getByRole('button', { name: '10.0.0.5' }))).toBe(false);
  });

  it('always lists the loopback entry, unchecked and enabled without the tunnel', () => {
    // 127.0.0.1 is never in the live IP enumeration, but must always be
    // offered — the tunnel forwards to it.
    const { getByRole } = renderSelector({});
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(false);
    expect(loopback.disabled).toBe(false);
  });

  it('selecting loopback adds 127.0.0.1 to the bind list', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('button', { name: m.settings_listenTargets_loopback_label() }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['192.168.1.10', '127.0.0.1'], tunnel: false });
  });

  it('keeps a bound IP visible even when missing from the live enumeration', () => {
    const { getByRole } = renderSelector({
      availableIps: ['10.0.0.5'],
      selectedIps: ['172.16.0.9'],
    });
    expect(isPressed(getByRole('button', { name: '172.16.0.9' }))).toBe(true);
  });

  it('selecting another IP emits the union of selected IPs', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('button', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['192.168.1.10', '10.0.0.5'], tunnel: false });
  });

  it('selecting all-interfaces is exclusive: it replaces specific IPs', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(
      getByRole('button', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    expect(onchange).toHaveBeenCalledWith({ ips: ['0.0.0.0'], tunnel: false });
  });

  it('locks the covered addresses checked while all-interfaces is bound', () => {
    // 0.0.0.0 already covers every address, so the individual entries render
    // checked but disabled until all-interfaces is unchecked.
    const { getByRole, getByText } = renderSelector({ selectedIps: ['0.0.0.0'] });
    for (const name of ['192.168.1.10', '10.0.0.5', m.settings_listenTargets_loopback_label()]) {
      const box = asButton(getByRole('button', { name }));
      expect(isPressed(box)).toBe(true);
      expect(box.disabled).toBe(true);
    }
    expect(getByText(m.settings_listenTargets_coveredByAllInterfaces_note())).toBeTruthy();
  });

  it('unchecking all-interfaces makes the covered addresses toggleable again', async () => {
    const { getByRole, rerender } = renderSelector({ selectedIps: ['0.0.0.0'] });
    expect(asButton(getByRole('button', { name: '10.0.0.5' })).disabled).toBe(true);
    await rerender({ selectedIps: ['127.0.0.1'] });
    const other = asButton(getByRole('button', { name: '10.0.0.5' }));
    expect(isPressed(other)).toBe(false);
    expect(other.disabled).toBe(false);
  });

  it('locks loopback checked while the tunnel is selected alongside specific IPs', () => {
    const { getByRole, getByText } = renderSelector({
      selectedIps: ['192.168.1.10', '127.0.0.1'],
      tunnelSelected: true,
    });
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(true);
    expect(loopback.disabled).toBe(true);
    expect(getByText(m.settings_listenTargets_loopbackRequired_note())).toBeTruthy();
  });

  it('shows the covered note (not the loopback note) while all-interfaces is bound with the tunnel', () => {
    const { getByRole, queryByText } = renderSelector({
      selectedIps: ['0.0.0.0'],
      tunnelSelected: true,
    });
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(true);
    expect(loopback.disabled).toBe(true);
    expect(queryByText(m.settings_listenTargets_loopbackRequired_note())).toBeNull();
  });

  it('load-repair: tunnel on without loopback renders it checked+locked and the next change persists it', async () => {
    // A daemon state persisted before the loopback rule (or configured
    // out-of-band): tunnel enabled, bindAddress without 127.0.0.1.
    const { getByRole, onchange } = renderSelector({
      selectedIps: ['192.168.1.10'],
      tunnelSelected: true,
    });
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(true);
    expect(loopback.disabled).toBe(true);
    await fireEvent.click(getByRole('button', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({
      ips: ['192.168.1.10', '10.0.0.5', '127.0.0.1'],
      tunnel: true,
    });
  });

  it('turning the tunnel off (parent toggle) unlocks loopback but keeps it selected', async () => {
    const { getByRole, rerender } = renderSelector({
      selectedIps: ['192.168.1.10', '127.0.0.1'],
      tunnelSelected: true,
    });
    await rerender({ selectedIps: ['192.168.1.10', '127.0.0.1'], tunnelSelected: false });
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(true);
    expect(loopback.disabled).toBe(false);
  });

  it('deselecting the last IP with the tunnel on yields tunnel-only and shows the note', async () => {
    const { getByRole, getByText, onchange, rerender } = renderSelector({ tunnelSelected: true });
    await fireEvent.click(getByRole('button', { name: '192.168.1.10' }));
    expect(onchange).toHaveBeenCalledWith({ ips: [], tunnel: true });
    await rerender({ selectedIps: [], tunnelSelected: true });
    expect(getByText(m.settings_listenTargets_tunnelOnly_note())).toBeTruthy();
  });

  it('all-interfaces is deselectable when another target is selected', async () => {
    // Regression: 0.0.0.0 rendered disabled when it was the sole IP, so it
    // could never be unchecked — e.g. to switch to tunnel-only.
    const { getByRole, onchange } = renderSelector({
      selectedIps: ['0.0.0.0'],
      tunnelSelected: true,
    });
    const allInterfaces = asButton(
      getByRole('button', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    expect(allInterfaces.disabled).toBe(false);
    await fireEvent.click(allInterfaces);
    expect(onchange).toHaveBeenCalledWith({ ips: [], tunnel: true });
  });

  it('never allows zero targets: unchecking the sole entry is refused and snaps back', async () => {
    const { getByRole, onchange } = renderSelector({});
    const sole = asButton(getByRole('button', { name: '192.168.1.10' }));
    expect(sole.disabled).toBe(false);
    await fireEvent.click(sole);
    expect(onchange).not.toHaveBeenCalled();
    expect(isPressed(getByRole('button', { name: '192.168.1.10' }))).toBe(true);
  });

  it('unchecking all-interfaces as the sole target falls back to loopback', async () => {
    // The covered addresses are locked while 0.0.0.0 is bound, so refusing
    // the uncheck would deadlock the picker — fall back to loopback instead.
    const { getByRole, onchange } = renderSelector({ selectedIps: ['0.0.0.0'] });
    const allInterfaces = asButton(
      getByRole('button', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    await fireEvent.click(allInterfaces);
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: false });
  });

  it('tunnel-only posture: loopback stays unchecked and unlocked (daemon binds it itself)', () => {
    const { getByRole } = renderSelector({ selectedIps: [], tunnelSelected: true });
    const loopback = asButton(
      getByRole('button', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(isPressed(loopback)).toBe(false);
    expect(loopback.disabled).toBe(false);
  });

  it('disables all checkboxes while a save is in flight', () => {
    const { getByRole } = renderSelector({ saving: true });
    expect(asButton(getByRole('button', { name: '10.0.0.5' })).disabled).toBe(true);
    expect(asButton(getByRole('button', { name: '192.168.1.10' })).disabled).toBe(true);
  });
});
