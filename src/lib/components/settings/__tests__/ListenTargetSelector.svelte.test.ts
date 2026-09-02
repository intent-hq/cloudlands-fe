/**
 * @vitest-environment jsdom
 *
 * ListenTargetSelector — the unified listen-target picker (bind IPs + the
 * tailcat tunnel entry). Covers the selection semantics the Advanced page
 * persists from: exclusive all-interfaces, tunnel-only, the never-zero-targets
 * guard, and graceful degradation when the daemon predates the tunnel
 * settings (tunnelSupported=false hides the tunnel entry).
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
      tunnelSupported: true,
      onchange,
      ...props,
    },
  });
  return { ...utils, onchange };
}

const asInput = (el: HTMLElement): HTMLInputElement => el as HTMLInputElement;

describe('ListenTargetSelector', () => {
  it('renders available IPs with the bound ones checked, plus all-interfaces and the tunnel entry', () => {
    const { getByRole } = renderSelector({});
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }))
        .checked,
    ).toBe(false);
    expect(asInput(getByRole('checkbox', { name: '192.168.1.10' })).checked).toBe(true);
    expect(asInput(getByRole('checkbox', { name: '10.0.0.5' })).checked).toBe(false);
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_tunnel_label() })).checked,
    ).toBe(false);
  });

  it('keeps a bound IP visible even when missing from the live enumeration', () => {
    const { getByRole } = renderSelector({
      availableIps: ['10.0.0.5'],
      selectedIps: ['172.16.0.9'],
    });
    expect(asInput(getByRole('checkbox', { name: '172.16.0.9' })).checked).toBe(true);
  });

  it('selecting another IP emits the union of selected IPs', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['192.168.1.10', '10.0.0.5'], tunnel: false });
  });

  it('selecting all-interfaces is exclusive: it replaces specific IPs', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(
      getByRole('checkbox', { name: m.settings_listenTargets_allInterfaces_label() }),
    );
    expect(onchange).toHaveBeenCalledWith({ ips: ['0.0.0.0'], tunnel: false });
  });

  it('selecting a specific IP while all-interfaces is bound drops the unspecified bind', async () => {
    const { getByRole, onchange } = renderSelector({ selectedIps: ['0.0.0.0'] });
    await fireEvent.click(getByRole('checkbox', { name: '10.0.0.5' }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['10.0.0.5'], tunnel: false });
  });

  it('selecting the tunnel keeps the IPs and flips tunnel on', async () => {
    const { getByRole, onchange } = renderSelector({});
    await fireEvent.click(getByRole('checkbox', { name: m.settings_listenTargets_tunnel_label() }));
    expect(onchange).toHaveBeenCalledWith({ ips: ['192.168.1.10'], tunnel: true });
  });

  it('deselecting the last IP with the tunnel on yields tunnel-only and shows the note', async () => {
    const { getByRole, getByText, onchange, rerender } = renderSelector({ tunnelSelected: true });
    await fireEvent.click(getByRole('checkbox', { name: '192.168.1.10' }));
    expect(onchange).toHaveBeenCalledWith({ ips: [], tunnel: true });
    await rerender({ selectedIps: [], tunnelSelected: true });
    expect(getByText(m.settings_listenTargets_tunnelOnly_note())).toBeTruthy();
  });

  it('never allows zero targets: the sole selected entry is disabled', () => {
    const { getByRole } = renderSelector({});
    expect(asInput(getByRole('checkbox', { name: '192.168.1.10' })).disabled).toBe(true);
  });

  it('tunnel-only state: the tunnel checkbox is disabled as the sole target', () => {
    const { getByRole } = renderSelector({ selectedIps: [], tunnelSelected: true });
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_tunnel_label() })).disabled,
    ).toBe(true);
  });

  it('degrades gracefully on old daemons: no tunnel entry when unsupported', () => {
    const { queryByRole } = renderSelector({ tunnelSupported: false });
    expect(
      queryByRole('checkbox', { name: m.settings_listenTargets_tunnel_label() }),
    ).toBeNull();
  });

  it('disables all checkboxes while a save is in flight', () => {
    const { getByRole } = renderSelector({ saving: true });
    expect(asInput(getByRole('checkbox', { name: '10.0.0.5' })).disabled).toBe(true);
    expect(
      asInput(getByRole('checkbox', { name: m.settings_listenTargets_tunnel_label() })).disabled,
    ).toBe(true);
  });
});
