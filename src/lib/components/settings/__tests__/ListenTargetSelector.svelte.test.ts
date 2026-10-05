/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import ListenTargetSelector from '../ListenTargetSelector.svelte';

async function renderSelector(props: Record<string, unknown> = {}) {
  const onchange = vi.fn();
  const view = render(ListenTargetSelector, {
    props: {
      availableIps: ['192.168.1.10', '10.0.0.5'],
      selectedIps: ['192.168.1.10'],
      tunnelSelected: false,
      onchange,
      ...props,
    },
  });
  const input = screen.getByRole('combobox', { name: m.settings_listenTargets_label() });
  await fireEvent.focus(input);
  return { ...view, onchange, input };
}
const pick = (name: string) =>
  fireEvent.pointerUp(screen.getByRole('option', { name }), { button: 0, pointerType: 'mouse' });
const selected = (name: string) =>
  screen.getByRole('option', { name }).getAttribute('aria-selected') === 'true';

describe('Available Networks multiselect', () => {
  it('summarizes implicit localhost and removes it from the summary when switching to all interfaces', async () => {
    const { input, onchange, rerender } = await renderSelector();
    expect(selected(m.settings_listenTargets_loopback_label())).toBe(true);
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe(
      `192.168.1.10, ${m.settings_listenTargets_loopback_label()}`,
    );
    expect(onchange).not.toHaveBeenCalled();
    await fireEvent.focus(input);
    await pick(m.settings_listenTargets_allInterfaces_label());
    expect(onchange).toHaveBeenCalledWith({ ips: ['0.0.0.0'], tunnel: false });
    await rerender({ selectedIps: ['0.0.0.0'] });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe(m.settings_listenTargets_allInterfaces_label());
  });
  it('adds a network while preserving existing addresses and ensuring loopback', async () => {
    const { onchange } = await renderSelector();
    await pick('10.0.0.5');
    expect(onchange).toHaveBeenCalledWith({
      ips: ['192.168.1.10', '10.0.0.5', '127.0.0.1'],
      tunnel: false,
    });
  });
  it('keeps the daemon selection when a change is rejected, and updates when accepted', async () => {
    const { onchange, rerender } = await renderSelector();
    await pick('10.0.0.5');
    expect(onchange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(selected('10.0.0.5')).toBe(false));
    await rerender({ selectedIps: ['192.168.1.10', '10.0.0.5', '127.0.0.1'] });
    await waitFor(() => expect(selected('10.0.0.5')).toBe(true));
  });
  it('keeps a currently bound address available for removal when its interface disappears', async () => {
    const { onchange } = await renderSelector({
      availableIps: ['10.0.0.5'],
      selectedIps: ['172.16.0.9'],
    });
    await pick('172.16.0.9');
    expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: false });
  });
  it('replaces specific networks with All interfaces', async () => {
    const { onchange } = await renderSelector();
    await pick(m.settings_listenTargets_allInterfaces_label());
    expect(onchange).toHaveBeenCalledWith({ ips: ['0.0.0.0'], tunnel: false });
  });
  for (const wildcard of ['0.0.0.0', '::']) {
    it(`falls back to localhost when removing ${wildcard}, then allows individual networks`, async () => {
      const { onchange, rerender } = await renderSelector({
        selectedIps: [wildcard],
        tunnelSelected: true,
      });
      expect(screen.getByRole('option', { name: '10.0.0.5' }).hasAttribute('data-disabled')).toBe(
        false,
      );
      await pick(
        wildcard === '0.0.0.0' ? m.settings_listenTargets_allInterfaces_label() : wildcard,
      );
      expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: true });
      await rerender({ selectedIps: ['127.0.0.1'] });
      await pick('10.0.0.5');
      expect(onchange).toHaveBeenLastCalledWith({ ips: ['127.0.0.1', '10.0.0.5'], tunnel: true });
    });
  }
  for (const tunnelSelected of [true, false]) {
    it(`never removes localhost while tunnel enabled is ${tunnelSelected}`, async () => {
      const { onchange } = await renderSelector({ selectedIps: ['127.0.0.1'], tunnelSelected });
      await pick(m.settings_listenTargets_loopback_label());
      expect(onchange).not.toHaveBeenCalled();
      await pick('10.0.0.5');
      expect(onchange).toHaveBeenCalledWith({
        ips: ['127.0.0.1', '10.0.0.5'],
        tunnel: tunnelSelected,
      });
    });
    it(`removing the last network falls back to localhost while tunnel enabled is ${tunnelSelected}`, async () => {
      const { onchange } = await renderSelector({ tunnelSelected });
      await pick('192.168.1.10');
      expect(onchange).toHaveBeenCalledWith({ ips: ['127.0.0.1'], tunnel: tunnelSelected });
    });
  }
  it('can enable networks from tunnel-only without dropping the tunnel', async () => {
    const { onchange } = await renderSelector({ selectedIps: [], tunnelSelected: true });
    await pick('10.0.0.5');
    expect(onchange).toHaveBeenCalledWith({ ips: ['10.0.0.5', '127.0.0.1'], tunnel: true });
  });
  it('blocks network changes while saving', async () => {
    const { input, onchange } = await renderSelector({ saving: true });
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onchange).not.toHaveBeenCalled();
  });
  it('has no scoped accessibility violations with the multiselect open', async () => {
    await renderSelector();
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  });
});
