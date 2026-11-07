/**
 * @vitest-environment jsdom
 *
 * Settings → Machines with E2B: the Add machine menu, the setup form, the
 * E2B row with its live sandboxes, and the state each one shows.
 */
import { fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import DevicesSettings from '$lib/components/settings/DevicesSettings.svelte';
import {
  setupCloudMachinesFixture,
  type CloudMachinesPreviewState,
} from '../../test/cloud-machines-preview';
import CloudMachineRow from './CloudMachineRow.svelte';

let restore: (() => void) | null = null;
function seed(state: CloudMachinesPreviewState) {
  store.init();
  restore = setupCloudMachinesFixture(state);
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

describe('Add machine', () => {
  it('opens a menu with E2B while E2B is supported and not set up', () => {
    seed('add-menu');
    const view = render(DevicesSettings);
    expect(view.getByTestId('add-machine-menu')).toBeTruthy();
    expect(view.container.querySelector('[data-cloud-machine-row]')).toBeNull();
  });

  it('stays a plain button when the backend has no cloud machines', () => {
    seed('unsupported');
    const view = render(DevicesSettings);
    expect(view.queryByTestId('add-machine-menu')).toBeNull();
  });

  it('stays a plain button once E2B is set up, and the E2B row shows', () => {
    seed('connected');
    const view = render(DevicesSettings);
    expect(view.queryByTestId('add-machine-menu')).toBeNull();
    expect(view.container.querySelector('[data-cloud-machine-row]')).not.toBeNull();
  });
});

describe('setup form', () => {
  it('needs a key before the first save, then sends it with the settings', async () => {
    seed('setup');
    const view = render(CloudMachineRow, { editing: true, onEdit: () => {}, onClose: () => {} });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    const save = within(form).getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const key = form.querySelector('input[type="password"]') as HTMLInputElement;
    await fireEvent.input(key, { target: { value: 'e2b_sk_test' } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({
      apiKey: 'e2b_sk_test',
      size: '4x8',
      idlePauseMinutes: 10,
      pausedDeleteDays: 7,
    });
    expect(form.querySelector('[data-cloud-privacy-note]')).not.toBeNull();
  });

  it('shows a working key and the published sizes after a test', () => {
    seed('setup-tested');
    const view = render(CloudMachineRow, { editing: true, onEdit: () => {}, onClose: () => {} });
    expect(view.container.querySelector('[data-cloud-key-ok]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-sizes-unknown]')).toBeNull();
  });

  it('asks for a test before sizes are known, and names a rejected key', () => {
    seed('setup-key-rejected');
    const view = render(CloudMachineRow, { editing: true, onEdit: () => {}, onClose: () => {} });
    expect(view.container.querySelector('[data-cloud-sizes-unknown]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-key-error]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-key-ok]')).toBeNull();
  });
});

describe('E2B row', () => {
  it('lists every sandbox with who started it, and pauses only running ones', () => {
    seed('connected');
    const view = render(CloudMachineRow, { editing: false, onEdit: () => {}, onClose: () => {} });
    const rows = view.container.querySelectorAll('[data-cloud-sandbox]');
    expect(rows).toHaveLength(3);
    const running = view.container.querySelector('[data-cloud-sandbox="sb-1"]') as HTMLElement;
    const paused = view.container.querySelector('[data-cloud-sandbox="sb-3"]') as HTMLElement;
    expect(running.textContent).toContain('Fix flaky CI');
    expect(running.textContent).toContain('Clément');
    const pauseRunning = within(running).getByRole('button', { name: /Pause the sandbox/ });
    const pausePaused = within(paused).getByRole('button', { name: /Pause the sandbox/ });
    expect((pauseRunning as HTMLButtonElement).disabled).toBe(false);
    expect((pausePaused as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(paused).getByRole('button', { name: /Delete the sandbox/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('offers to stop agents when removal finds live sandboxes', async () => {
    seed('remove-in-use');
    const view = render(CloudMachineRow, { editing: false, onEdit: () => {}, onClose: () => {} });
    await fireEvent.click(view.getByRole('button', { name: 'Stop agents and remove' }));
    const remove = dispatched().find((action) => action.type === 'cloudMachines/removeRequested');
    expect(remove?.payload).toEqual([true]);
  });
});
