/**
 * @vitest-environment jsdom
 *
 * ListenTargetSelector — the listen-target picker (bind IPs; the tailcat
 * tunnel is toggled by the parent, mirrored in via `tunnelSelected`). Covers
 * the selection semantics the Advanced page persists from: loopback always
 * bound and locked (every emission carries 127.0.0.1 unless 0.0.0.0 covers
 * it), exclusive all-interfaces (which locks the covered addresses checked
 * while selected), and hand-picking specific IPs on top of loopback.
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

const asInput = (el: HTMLElement): HTMLInputElement => el as HTMLInputElement;

describe('ListenTargetSelector', () => {
  it('renders available IPs with the bound ones checked, plus all-interfaces', () => {
    const { getByRole } = renderSelector({});
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }))
        .checked,
    ).toBe(false);
    expect(asInput(getByRole('checkbox', { name: '192.168.1.10' })).checked).toBe(true);
    expect(asInput(getByRole('checkbox', { name: '10.0.0.5' })).checked).toBe(false);
  });

  it('always lists loopback checked and locked, even when absent from selectedIps', () => {
    // 127.0.0.1 is never in the live IP enumeration and may be missing from a
    // bindAddress persisted before the always-bound rule; it is still always
    // offered, checked and non-interactive, with the explanatory note.
    const { getByRole, getByText } = renderSelector({});
    const loopback = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(loopback.checked).toBe(true);
    expect(loopback.disabled).toBe(true);
    expect(getByText(m.settings_listenTargets_loopbackAlwaysBound_note())).toBeTruthy();
  });

  it('keeps loopback locked regardless of the tunnel toggle', async () => {
    const { getByRole, rerender } = renderSelector({
      selectedIps: ['192.168.1.10', '127.0.0.1'],
      tunnelSelected: true,
    });
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_loopback_label() })).disabled,
    ).toBe(true);
    await rerender({ selectedIps: ['192.168.1.10', '127.0.0.1'], tunnelSelected: false });
    const loopback = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(loopback.checked).toBe(true);
    expect(loopback.disabled).toBe(true);
  });

  it('keeps a bound IP visible even when missing from the live enumeration', () => {
    const { getByRole } = renderSelector({
      availableIps: ['10.0.0.5'],
      selectedIps: ['172.16.0.9'],
    });
    expect(asInput(getByRole('checkbox', { name: '172.16.0.9' })).checked).toBe(true);
  });

  it('selecting another IP emits the union of selected IPs plus loopback', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({
      ips: ['192.168.1.10', '10.0.0.5', '127.0.0.1'],
      tunnel: false,
    });
  });

  it('does not duplicate loopback when it is already selected', async () => {
    const { getByRole, onchange } = renderSelector({ selectedIps: ['127.0.0.1', '192.168.1.10'] });
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({
      ips: ['127.0.0.1', '192.168.1.10', '10.0.0.5'],
      tunnel: false,
    });
  });

  it('selecting all-interfaces is exclusive: it replaces specific IPs', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(
      getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    expect(onchange).toHaveBeenCalledWith({ ips: ['0.0.0.0'], tunnel: false });
  });

  it('treats an out-of-band IPv6 unspecified bind ("::") like all-interfaces', async () => {
    // The daemon requires "::" to stand alone, exactly like 0.0.0.0. The
    // selector has no IPv6 UI, so "::" renders as a plain bound entry, but
    // it covers the other addresses (locked) and never gets loopback
    // appended; unchecking it falls back to loopback-only.
    const { getByRole, onchange } = renderSelector({ selectedIps: ['::'] });
    const specific = asInput(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(specific.checked).toBe(true);
    expect(specific.disabled).toBe(true);
    const v6 = asInput(getByRole('checkbox', { name: '::' }));
    expect(v6.checked).toBe(true);
    expect(v6.disabled).toBe(false);
    await fireEvent.click(v6);
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: false });
  });

  it('locks the covered addresses checked while all-interfaces is bound', () => {
    // 0.0.0.0 already covers every address, so the individual entries render
    // checked but disabled until all-interfaces is unchecked.
    const { getByRole, getByText } = renderSelector({ selectedIps: ['0.0.0.0'] });
    for (const name of ['192.168.1.10', '10.0.0.5', m.settings_listenTargets_loopback_label()]) {
      const box = asInput(getByRole('checkbox', { name }));
      expect(box.checked).toBe(true);
      expect(box.disabled).toBe(true);
    }
    expect(getByText(m.settings_listenTargets_coveredByAllInterfaces_note())).toBeTruthy();
  });

  it('unchecking all-interfaces makes the covered addresses toggleable again', async () => {
    const { getByRole, rerender } = renderSelector({ selectedIps: ['0.0.0.0'] });
    expect(asInput(getByRole('checkbox', { name: '10.0.0.5' })).disabled).toBe(true);
    await rerender({ selectedIps: ['127.0.0.1'] });
    const other = asInput(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(other.checked).toBe(false);
    expect(other.disabled).toBe(false);
  });

  it('shows the covered note (not the loopback note) while all-interfaces is bound', () => {
    const { getByRole, queryByText } = renderSelector({
      selectedIps: ['0.0.0.0'],
      tunnelSelected: true,
    });
    const loopback = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(loopback.checked).toBe(true);
    expect(loopback.disabled).toBe(true);
    expect(queryByText(m.settings_listenTargets_loopbackAlwaysBound_note())).toBeNull();
  });

  it('load-repair: a bindAddress without loopback persists it on the next change', async () => {
    // A daemon state persisted before the always-bound rule (or configured
    // out-of-band): tunnel enabled, bindAddress without 127.0.0.1.
    const { getByRole, onchange } = renderSelector({
      selectedIps: ['192.168.1.10'],
      tunnelSelected: true,
    });
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({
      ips: ['192.168.1.10', '10.0.0.5', '127.0.0.1'],
      tunnel: true,
    });
  });

  it('deselecting the last specific IP leaves loopback-only (never tunnel-only, never zero)', async () => {
    const { getByRole, onchange } = renderSelector({ tunnelSelected: true });
    await fireEvent.click(getByRole('checkbox', { name: '192.168.1.10' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: true });
  });

  it('unchecking the sole specific IP without the tunnel also leaves loopback-only', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('checkbox', { name: '192.168.1.10' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: false });
  });

  it('all-interfaces is deselectable and falls back to loopback, carrying the tunnel state', async () => {
    // Regression: 0.0.0.0 rendered disabled when it was the sole IP, so it
    // could never be unchecked to pick specific IPs.
    const { getByRole, onchange } = renderSelector({
      selectedIps: ['0.0.0.0'],
      tunnelSelected: true,
    });
    const allInterfaces = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    expect(allInterfaces.disabled).toBe(false);
    await fireEvent.click(allInterfaces);
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: true });
  });

  it('unchecking all-interfaces as the sole target falls back to loopback', async () => {
    // The covered addresses are locked while 0.0.0.0 is bound, so unchecking
    // it is the only way out — land on loopback-only so the individual
    // entries become toggleable again.
    const { getByRole, onchange } = renderSelector({ selectedIps: ['0.0.0.0'] });
    const allInterfaces = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    await fireEvent.click(allInterfaces);
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: false });
  });

  it('loopback-only: the specific IPs render unchecked and toggleable', async () => {
    const { getByRole, onchange } = renderSelector({ selectedIps: ['127.0.0.1'] });
    for (const name of ['192.168.1.10', '10.0.0.5']) {
      const box = asInput(getByRole('checkbox', { name }));
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(false);
    }
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1', '10.0.0.5'], tunnel: false });
  });

  it('tunnel-only posture (persisted out-of-band): loopback still renders checked+locked with the note', () => {
    const { getByRole, getByText } = renderSelector({ selectedIps: [], tunnelSelected: true });
    const loopback = asInput(
      getByRole('checkbox', { name: m.settings_listenTargets_loopback_label() }),
    );
    expect(loopback.checked).toBe(true);
    expect(loopback.disabled).toBe(true);
    expect(getByText(m.settings_listenTargets_tunnelOnly_note())).toBeTruthy();
  });

  it('disables all checkboxes while a save is in flight', () => {
    const { getByRole } = renderSelector({ saving: true });
    expect(asInput(getByRole('checkbox', { name: '10.0.0.5' })).disabled).toBe(true);
    expect(asInput(getByRole('checkbox', { name: '192.168.1.10' })).disabled).toBe(true);
  });
});
