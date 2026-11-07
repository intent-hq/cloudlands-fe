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
  E2B_PROVIDER,
  TEAM_ENTRY,
  setupCloudMachinesFixture,
  type CloudMachinesPreviewState,
} from '../../test/cloud-machines-preview';
import CloudMachineRow from './CloudMachineRow.svelte';
import { NEW_CLOUD_ENTRY, cloudMachineValidated } from './cloud-machines-slice';

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

  it('has no E2B item when the backend has no cloud machines', async () => {
    seed('unsupported');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    await view.findByTestId('add-machine-paste-link');
    expect(view.queryByTestId('add-cloud-machine')).toBeNull();
  });

  it('hides E2B setup, the E2B row and its sandboxes while the Labs flag is off', async () => {
    seed('labs-off');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    await view.findByTestId('add-machine-paste-link');
    expect(view.queryByTestId('add-cloud-machine')).toBeNull();
    expect(view.container.querySelector('[data-cloud-machine-row]')).toBeNull();
    expect(view.container.querySelector('[data-cloud-sandboxes]')).toBeNull();
  });

  it('has no E2B item once E2B is set up, and the E2B row shows', async () => {
    seed('connected');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    await view.findByTestId('add-machine-paste-link');
    expect(view.queryByTestId('add-cloud-machine')).toBeNull();
    expect(view.container.querySelector('[data-cloud-machine-row]')).not.toBeNull();
  });
});

describe('setup form', () => {
  it('needs a key before the first save, then sends it with the settings', async () => {
    seed('setup');
    const view = render(CloudMachineRow, {
      entry: null,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
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
    const view = render(CloudMachineRow, {
      entry: null,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    expect(view.container.querySelector('[data-cloud-key-ok]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-sizes-unknown]')).toBeNull();
  });

  it('keeps the size picker after the test result is cleared by an edit', async () => {
    seed('setup-tested');
    const view = render(CloudMachineRow, {
      entry: null,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    store.dispatch(cloudMachineValidated(NEW_CLOUD_ENTRY, null));
    await vi.waitFor(() => expect(view.container.querySelector('[data-cloud-key-ok]')).toBeNull());
    expect(view.container.querySelector('[data-cloud-sizes-unknown]')).toBeNull();
  });

  it('asks for a test before sizes are known, and names a rejected key', () => {
    seed('setup-key-rejected');
    const view = render(CloudMachineRow, {
      entry: null,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    expect(view.container.querySelector('[data-cloud-sizes-unknown]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-key-error]')).not.toBeNull();
    expect(view.container.querySelector('[data-cloud-key-ok]')).toBeNull();
  });
});

describe('E2B row', () => {
  it('lists every sandbox with who started it, and pauses only running ones', () => {
    seed('connected');
    const view = render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });
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
    const view = render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });
    await fireEvent.click(view.getByRole('button', { name: 'Stop agents and remove' }));
    const remove = dispatched().find((action) => action.type === 'cloudMachines/removeRequested');
    expect(remove?.payload).toEqual(['e2b', true]);
  });
});

describe('named E2B entries under Nodes', () => {
  it('lists each entry by name in Nodes, each with its own sandboxes', () => {
    seed('entries');
    const view = render(DevicesSettings);
    const nodes = view.container.querySelector('[data-nodes-section]') as HTMLElement;
    expect(nodes).not.toBeNull();
    const rows = nodes.querySelectorAll('[data-cloud-machine-row]');
    expect([...rows].map((row) => row.getAttribute('data-cloud-machine-row'))).toEqual([
      'e2b',
      TEAM_ENTRY.id,
    ]);
    expect(rows[0]!.querySelectorAll('[data-cloud-sandbox]')).toHaveLength(3);
    const team = rows[1] as HTMLElement;
    expect(team.textContent).toContain('Team project');
    expect([...team.querySelectorAll('[data-cloud-sandbox]')].map((r) => r.textContent)).toEqual([
      expect.stringContaining('Release notes'),
    ]);
    expect(team.textContent).not.toContain('Team project · Release notes');
    expect(view.container.querySelectorAll('[data-cloud-machine-row]')).toHaveLength(2);
  });

  it('still offers E2B in Add machine to add another entry', async () => {
    seed('entries');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    expect(await view.findByTestId('add-cloud-machine')).toBeTruthy();
  });

  it('asks a new entry for a free name, then sends it with the key', async () => {
    seed('entries-add');
    const view = render(DevicesSettings, { initialCloudSetup: true });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    const name = within(form).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('E2B 2');
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const key = form.querySelector('input[type="password"]') as HTMLInputElement;
    await fireEvent.input(key, { target: { value: 'e2b_sk_team' } });
    await fireEvent.input(name, { target: { value: ' team PROJECT ' } });
    expect(form.querySelector('[data-cloud-name-error]')).not.toBeNull();
    expect(save.disabled).toBe(true);
    await fireEvent.input(name, { target: { value: ' Staging ' } });
    expect(form.querySelector('[data-cloud-name-error]')).toBeNull();
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({ name: 'Staging', apiKey: 'e2b_sk_team' });
    expect(configure?.payload[0]).not.toHaveProperty('cloudMachineId');
  });

  it('can reuse the key of another entry instead of pasting one', async () => {
    seed('entries-add');
    const view = render(DevicesSettings, { initialCloudSetup: true });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    await fireEvent.click(
      within(form).getByRole('button', { name: 'Use the key of another entry' }),
    );
    await fireEvent.click(await view.findByRole('menuitem', { name: 'Team project' }));
    expect(form.querySelector('input[type="password"]')).toBeNull();
    expect(form.textContent).toContain('Same key as Team project');
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({ name: 'E2B 2', apiKeyFrom: TEAM_ENTRY.id });
    expect(configure?.payload[0]).not.toHaveProperty('apiKey');
  });

  it('renames an entry in place', async () => {
    seed('entries');
    const view = render(CloudMachineRow, {
      entry: TEAM_ENTRY,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });
    await fireEvent.click(view.getByRole('button', { name: 'Rename Team project' }));
    const input = view.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Big boxes' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toEqual({ cloudMachineId: TEAM_ENTRY.id, name: 'Big boxes' });
  });

  it('removes only the chosen entry', async () => {
    seed('entries');
    const view = render(CloudMachineRow, {
      entry: TEAM_ENTRY,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });
    await fireEvent.click(view.getByRole('button', { name: /Actions for Team project/ }));
    await fireEvent.click(await view.findByRole('menuitem', { name: 'Remove' }));
    const remove = dispatched().find((action) => action.type === 'cloudMachines/removeRequested');
    expect(remove?.payload).toEqual([TEAM_ENTRY.id]);
  });
});
