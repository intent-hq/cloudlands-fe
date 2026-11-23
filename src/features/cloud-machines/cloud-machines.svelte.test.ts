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
  AGENT37_ENTRY,
  E2B_PROVIDER,
  NORTHFLANK_ENTRY,
  GROUPED_SANDBOXES,
  TEAM_ENTRY,
  VERCEL_ENTRY,
  setupCloudMachinesFixture,
  type CloudMachinesPreviewState,
} from '../../test/cloud-machines-preview';
import CloudMachineRow from './CloudMachineRow.svelte';
import CloudSandboxList from './CloudSandboxList.svelte';
import { setAgentsLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  NEW_CLOUD_ENTRY,
  cloudConfigureKey,
  cloudMachineOperationSettled,
  cloudMachineOperationStarted,
  cloudMachineValidated,
  cloudMachinesLoaded,
} from './cloud-machines-slice';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

const navigateToDesktopAgent = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$features/desktop/desktop-agent-navigation', () => ({ navigateToDesktopAgent }));

let restore: (() => void) | null = null;
function seed(state: CloudMachinesPreviewState, options?: { listsOpen?: boolean }) {
  store.init();
  restore = setupCloudMachinesFixture(state, options);
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

/** No cloud choice: Add machine opens the wizard at once, with no one-item menu. */
async function opensWizardDirectly(view: ReturnType<typeof render>) {
  await fireEvent.click(await view.findByTestId('add-machine-menu'));
  expect(dispatched().map((a) => a.type)).toContain('machineSetup/opened');
  expect(view.queryByTestId('add-machine-setup')).toBeNull();
}

describe('Add machine', () => {
  it('opens a menu with E2B while E2B is supported and not set up', () => {
    seed('add-menu');
    const view = render(DevicesSettings);
    expect(view.getByTestId('add-machine-menu')).toBeTruthy();
    expect(view.container.querySelector('[data-cloud-machine-row]')).toBeNull();
  });

  it('has no E2B item when the backend has no cloud machines', async () => {
    seed('unsupported');
    const view = render(DevicesSettings);
    await opensWizardDirectly(view);
    expect(view.queryByTestId('add-cloud-e2b')).toBeNull();
  });

  it('offers no cloud provider while Remote agents is off', async () => {
    seed('add-cloud-menu');
    store.dispatch(setLabsRemoteAgentsEnabled(false));
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    expect(await view.findByTestId('add-machine-menu')).toBeTruthy();
    expect(view.queryByTestId('add-cloud-e2b')).toBeNull();
    expect(view.queryByTestId('add-cloud-northflank')).toBeNull();
  });

  it('offers every cloud provider the backend lists before any cloud machine is saved', async () => {
    seed('agent37-add-menu');
    store.dispatch(
      cloudMachinesLoaded({
        supported: true,
        entries: true,
        providerKinds: ['e2b', 'northflank', 'agent37'],
        providers: [],
        machines: [],
        readAt: Date.now(),
      }),
    );
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    expect(await view.findByTestId('add-cloud-e2b')).toBeTruthy();
    expect(view.getByTestId('add-cloud-northflank')).toBeTruthy();
    expect(view.getByTestId('add-cloud-agent37')).toBeTruthy();
  });

  it('has no E2B item once E2B is set up, and the E2B row shows', async () => {
    seed('connected');
    const view = render(DevicesSettings);
    await opensWizardDirectly(view);
    expect(view.queryByTestId('add-cloud-e2b')).toBeNull();
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
    expect(running.textContent).toContain('iOS build fixer');
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

describe('sandboxes grouped by workspace', () => {
  const groups = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-cloud-sandbox-group]')] as HTMLElement[];
  const toggle = (group: HTMLElement) =>
    group.querySelector('[data-cloud-sandbox-group-toggle]') as HTMLButtonElement;
  const header = (group: HTMLElement) => toggle(group).textContent!.replace(/\s+/g, ' ').trim();
  const isLinked = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-cloud-sandbox="${id}"] [data-cloud-sandbox-agent-link]`) !== null;
  const rowIds = (group: HTMLElement) =>
    [...group.querySelectorAll('[data-cloud-sandbox]')].map((row) =>
      row.getAttribute('data-cloud-sandbox'),
    );
  const list = (sandboxes = GROUPED_SANDBOXES) =>
    render(CloudSandboxList, { sandboxes, entryName: E2B_PROVIDER.name });

  it('puts groups with running sandboxes first, then running rows, newest first', () => {
    seed('sandboxes-grouped');
    const view = list();
    const all = groups(view.container);
    // Only a workspace with more than one sandbox is a collapsible group.
    expect(all.map(header)).toEqual(['Fix flaky CI · 3']);
    expect(toggle(all[0]!).getAttribute('aria-expanded')).toBe('true');
    expect(rowIds(view.container)).toEqual(['sb-6', 'sb-1', 'sb-4', 'sb-2', 'sb-5', 'sb-3']);
  });

  it('rows show the agent over its workspace when ungrouped, starter and uptime, with a state dot', () => {
    seed('sandboxes-grouped');
    const view = list();
    const section = view.container.querySelector('[data-cloud-sandboxes]') as HTMLElement;
    const text = (id: string) =>
      view.container
        .querySelector(`[data-cloud-sandbox="${id}"]`)!
        .textContent!.replace(/\s+/g, ' ')
        .trim();
    expect(text('sb-2')).toBe('Docs sweeper Protocol docs · Sam · 1 h 12 min');
    expect(
      view.container
        .querySelector('[data-cloud-sandbox="sb-2"] [data-cloud-sandbox-status]')
        ?.getAttribute('aria-label'),
    ).toBe('Running');
    // Grouped rows and the Other workspace do not repeat a workspace.
    expect(text('sb-1')).not.toContain('Fix flaky CI');
    expect(
      view.container.querySelector('[data-cloud-sandbox="sb-5"] [data-cloud-sandbox-workspace]'),
    ).toBeNull();
    expect(section.textContent).not.toMatch(/\$|≈/u);
  });

  it('collapses and expands a group, and remembers it for the session', async () => {
    seed('sandboxes-grouped');
    const view = list();
    const ci = groups(view.container)[0]!;
    await fireEvent.click(toggle(ci));
    expect(toggle(ci).getAttribute('aria-expanded')).toBe('false');
    expect(rowIds(ci)).toEqual([]);
    expect(header(ci)).toBe('Fix flaky CI · 3');
    expect(view.container.querySelector('[data-cloud-sandbox="sb-2"]')).not.toBeNull();

    view.unmount();
    const again = list();
    const ciAgain = groups(again.container)[0]!;
    expect(toggle(ciAgain).getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle(ciAgain));
    expect(rowIds(ciAgain)).toEqual(['sb-6', 'sb-1', 'sb-4']);
  });

  it("links the agent name to the sandbox's agent in its workspace", async () => {
    seed('sandboxes-grouped');
    const view = list();
    const row = view.container.querySelector('[data-cloud-sandbox="sb-1"]') as HTMLElement;
    const link = within(row).getByRole('button', { name: 'iOS build fixer' });
    await fireEvent.click(link);
    expect(navigateToDesktopAgent).toHaveBeenCalledWith('ws-ci', 'agent-sb-1');
  });

  it('shows plain text for an agent being deleted, or a workspace the app does not know', () => {
    seed('sandboxes-grouped');
    const view = list();
    expect(isLinked(view.container, 'sb-3')).toBe(false);
    expect(isLinked(view.container, 'sb-5')).toBe(false);
    expect(view.container.querySelector('[data-cloud-sandbox="sb-3"]')!.textContent).toContain(
      'Perf profiler',
    );
  });

  it('keeps the link for an agent the read agent list left out', () => {
    seed('sandboxes-grouped');
    store.dispatch(setAgentsLoaded('ws-docs', true));
    try {
      expect(isLinked(list().container, 'sb-2')).toBe(true);
    } finally {
      store.dispatch(setAgentsLoaded('ws-docs', false));
    }
  });

  it('shows a lone sandbox of an unknown workspace with no group or workspace name', () => {
    seed('sandboxes-grouped');
    const view = list(GROUPED_SANDBOXES.filter((row) => row.cloud?.workspaceId === 'ws-elsewhere'));
    expect(groups(view.container)).toEqual([]);
    expect(rowIds(view.container)).toEqual(['sb-5']);
    expect(view.container.querySelector('[data-cloud-sandbox-workspace]')).toBeNull();
  });

  it('shows no list without sandboxes', () => {
    seed('connected-no-sandboxes');
    const view = render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });
    expect(view.container.querySelector('[data-cloud-sandboxes]')).toBeNull();
    expect(view.container.querySelector('[data-cloud-relay]')).toBeNull();
  });

  it('names a custom relay its sandboxes use, and nothing for the default relays', () => {
    const props = { entry: E2B_PROVIDER, editing: false, onEdit: () => {}, onClose: () => {} };
    seed('relay');
    const custom = render(CloudMachineRow, props);
    expect(custom.container.querySelector('[data-cloud-relay]')?.textContent).toBe(
      'Relay: relay.example.com',
    );
    custom.unmount();
    restore?.();
    seed('connected');
    const fallback = render(CloudMachineRow, props);
    expect(fallback.container.querySelector('[data-cloud-sandboxes]')).not.toBeNull();
    expect(fallback.container.querySelector('[data-cloud-relay]')).toBeNull();
  });
});

describe('sandbox list under a cloud runner', () => {
  const collapsed = { listsOpen: false };
  const row = (view: { container: HTMLElement }, id: string) =>
    view.container.querySelector(`[data-cloud-machine-row="${id}"]`) as HTMLElement;
  const toggle = (root: HTMLElement) =>
    root.querySelector('[data-cloud-sandboxes-toggle]') as HTMLButtonElement;
  const counts = (root: HTMLElement) =>
    root.querySelector('[data-cloud-sandbox-counts]')?.textContent?.replace(/\s+/g, ' ').trim();
  const list = (root: HTMLElement) => root.querySelector('[data-cloud-sandboxes]');
  const rowCount = (root: HTMLElement) => root.querySelectorAll('[data-cloud-sandbox]').length;
  const e2bRow = () =>
    render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: false,
      onEdit: () => {},
      onClose: () => {},
    });

  it('is one row by default, with the running and paused counts on it', () => {
    seed('connected', collapsed);
    const view = e2bRow();
    expect(toggle(view.container).getAttribute('aria-expanded')).toBe('false');
    expect(counts(view.container)).toBe('2 running · 1 paused');
    expect(list(view.container)).toBeNull();
    expect(view.queryByRole('link', { name: 'Open E2B dashboard' })).toBeNull();
  });

  it('opens from the row and keeps the counts on it', async () => {
    seed('connected', collapsed);
    const view = e2bRow();
    await fireEvent.click(view.container.querySelector('[data-slot="list-row"]')!);
    expect(toggle(view.container).getAttribute('aria-expanded')).toBe('true');
    expect(rowCount(view.container)).toBe(3);
    expect(counts(view.container)).toBe('2 running · 1 paused');
    expect(view.getByRole('link', { name: 'Open E2B dashboard' }).textContent?.trim()).toBe(
      'Dashboard',
    );
    await fireEvent.click(toggle(view.container));
    expect(list(view.container)).toBeNull();
  });

  it('does not toggle from the row menu', async () => {
    seed('connected', collapsed);
    const view = e2bRow();
    await fireEvent.click(view.getByRole('button', { name: /Actions for E2B/ }));
    expect(toggle(view.container).getAttribute('aria-expanded')).toBe('false');
  });

  it('remembers open or collapsed per runner for the session', async () => {
    seed('entries', collapsed);
    const view = render(DevicesSettings);
    await fireEvent.click(toggle(row(view, 'e2b')));
    expect(rowCount(row(view, 'e2b'))).toBe(3);
    // A runner with one sandbox shows it, with no toggle.
    expect(rowCount(row(view, TEAM_ENTRY.id))).toBe(1);
    expect(toggle(row(view, TEAM_ENTRY.id))).toBeNull();

    view.unmount();
    const again = render(DevicesSettings);
    expect(rowCount(row(again, 'e2b'))).toBe(3);
    await fireEvent.click(toggle(row(again, 'e2b')));
    expect(rowCount(row(again, 'e2b'))).toBe(0);
  });

  it('lists one sandbox per workspace as plain rows, with no group toggles', async () => {
    seed('connected', collapsed);
    const view = e2bRow();
    await fireEvent.click(toggle(view.container));
    expect(view.container.querySelector('[data-cloud-sandbox-group]')).toBeNull();
    expect(view.container.querySelectorAll('[data-cloud-sandbox-workspace]')).toHaveLength(3);
    expect(rowCount(view.container)).toBe(3);
  });

  it('opens a collapsed list while a sandbox there has failed, so the error shows', () => {
    seed('connected', collapsed);
    store.dispatch(cloudMachineOperationSettled('sb-1', { message: 'Pause failed' }));
    const view = e2bRow();
    expect(toggle(view.container).getAttribute('aria-expanded')).toBe('true');
    expect(view.getByRole('alert').textContent).toContain('Pause failed');
  });

  it('has no toggle or counts without sandboxes', () => {
    seed('connected-no-sandboxes', collapsed);
    const view = e2bRow();
    expect(toggle(view.container)).toBeNull();
    expect(counts(view.container)).toBeUndefined();
  });

  it("names an Agent37 runner's list Instances", async () => {
    seed('agent37-providers', collapsed);
    const view = render(DevicesSettings);
    const agent37 = row(view, AGENT37_ENTRY.id);
    expect(counts(agent37)).toBe('1 running · 1 paused');
    await fireEvent.click(toggle(agent37));
    expect(list(agent37)?.textContent).toContain('Instances');
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
    expect(await view.findByTestId('add-cloud-e2b')).toBeTruthy();
    expect(view.getByTestId('add-machine-setup')).toBeTruthy();
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

  it('shows the saved name in the edit form and renames through Save', async () => {
    seed('entries');
    const view = render(CloudMachineRow, {
      entry: TEAM_ENTRY,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    const name = within(form).getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Team project');
    expect(view.queryByRole('button', { name: 'Rename Team project' })).toBeNull();
    await fireEvent.input(name, { target: { value: 'e2b' } });
    expect(form.querySelector('[data-cloud-name-error]')).not.toBeNull();
    await fireEvent.input(name, { target: { value: ' Big boxes ' } });
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({
      cloudMachineId: TEAM_ENTRY.id,
      name: 'Big boxes',
    });
    expect(configure?.payload[0]).not.toHaveProperty('apiKey');
  });

  it('has no Name field on a backend without entries', () => {
    seed('connected');
    const view = render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    expect(within(form).queryByLabelText('Name')).toBeNull();
  });

  it('sends no name from the edit form when it is unchanged', async () => {
    seed('entries-single');
    const view = render(CloudMachineRow, {
      entry: E2B_PROVIDER,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('E2B');
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({ cloudMachineId: 'e2b' });
    expect(configure?.payload[0]).not.toHaveProperty('name');
  });

  it('adds a second entry from Add machine next to the only one, without its id', async () => {
    seed('entries-single');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    await fireEvent.click(await view.findByTestId('add-cloud-e2b'));
    const form = await vi.waitFor(() => {
      const found = view.container.querySelector(
        '[data-cloud-machine-row="new"] form[data-cloud-machine-form]',
      );
      expect(found).not.toBeNull();
      return found as HTMLFormElement;
    });
    expect(view.container.querySelector('[data-cloud-machine-row="e2b"] form')).toBeNull();
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('E2B 2');
    const key = form.querySelector('input[type="password"]') as HTMLInputElement;
    await fireEvent.input(key, { target: { value: 'e2b_sk_second' } });
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({ name: 'E2B 2', apiKey: 'e2b_sk_second' });
    expect(configure?.payload[0]).not.toHaveProperty('cloudMachineId');
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

describe('Add cloud', () => {
  it('offers E2B and Northflank when the backend has both', async () => {
    seed('add-cloud-menu');
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    expect(await view.findByTestId('add-cloud-e2b')).toBeTruthy();
    expect(view.getByTestId('add-cloud-northflank')).toBeTruthy();
  });

  it('offers E2B directly, without a submenu, to a backend without Northflank', async () => {
    seed('add-menu');
    const view = render(DevicesSettings, { initialAddMenuOpen: true });
    expect(await view.findByTestId('add-cloud-e2b')).toBeTruthy();
    expect(view.queryByTestId('add-cloud-machine')).toBeNull();
    expect(view.queryByTestId('add-cloud-northflank')).toBeNull();
  });

  it('offers Agent37 only when the backend lists it', async () => {
    seed('agent37-add-menu');
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    expect((await view.findByTestId('add-cloud-agent37')).textContent).toContain('Agent37');
    restore?.();
    view.unmount();
    seed('add-cloud-menu');
    const without = render(DevicesSettings, {
      initialAddMenuOpen: true,
      initialAddCloudOpen: true,
    });
    expect(await without.findByTestId('add-cloud-northflank')).toBeTruthy();
    expect(without.queryByTestId('add-cloud-agent37')).toBeNull();
  });

  it('offers Vercel only when the backend lists it', async () => {
    seed('vercel-add-menu');
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    expect((await view.findByTestId('add-cloud-vercel')).textContent).toContain('Vercel');
    restore?.();
    view.unmount();
    seed('agent37-add-menu');
    const without = render(DevicesSettings, {
      initialAddMenuOpen: true,
      initialAddCloudOpen: true,
    });
    expect(await without.findByTestId('add-cloud-agent37')).toBeTruthy();
    expect(without.queryByTestId('add-cloud-vercel')).toBeNull();
  });

  it('opens the Northflank form from the menu', async () => {
    seed('add-cloud-menu');
    const view = render(DevicesSettings, { initialAddMenuOpen: true, initialAddCloudOpen: true });
    await fireEvent.click(await view.findByTestId('add-cloud-northflank'));
    await vi.waitFor(() =>
      expect(view.container.querySelector('form[data-cloud-provider="northflank"]')).not.toBeNull(),
    );
  });
});

describe('Northflank form', () => {
  function renderForm() {
    seed('northflank-setup');
    return render(CloudMachineRow, {
      entry: null,
      newProvider: 'northflank',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
  }

  it('needs a token and project, shows the region read-only, then sends them', async () => {
    const view = renderForm();
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const token = form.querySelector('input[type="password"]') as HTMLInputElement;
    const project = form.querySelector('input[data-cloud-project]');
    expect(project).toBeTruthy();
    expect(form.querySelector('input[data-cloud-region]')).toBeNull();
    expect(form.querySelector('[data-cloud-region]')).not.toBeNull();
    await fireEvent.input(token, { target: { value: 'nf_test' } });
    expect(save.disabled).toBe(true);
    await fireEvent.input(project!, { target: { value: 'intent-agents' } });
    expect(save.disabled).toBe(false);
    await fireEvent.submit(form);
    const configure = dispatched().find(
      (action) => action.type === 'cloudMachines/configureRequested',
    );
    expect(configure?.payload[0]).toMatchObject({
      provider: 'northflank',
      apiKey: 'nf_test',
      projectId: 'intent-agents',
    });
    expect(configure?.payload[0]).not.toHaveProperty('region');
  });

  it('names Northflank in a rejected token', () => {
    seed('northflank-setup-error');
    const view = render(CloudMachineRow, {
      entry: null,
      newProvider: 'northflank',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const error = view.container.querySelector('[data-cloud-key-error]');
    expect(error?.textContent).toContain('Northflank');
  });

  it('shows each entry provider in the list', () => {
    seed('providers');
    const view = render(DevicesSettings);
    const rows = [...view.container.querySelectorAll('[data-cloud-machine-row]')];
    expect(rows.map((row) => row.getAttribute('data-cloud-provider'))).toEqual([
      'e2b',
      'northflank',
    ]);
    expect(rows[1]?.textContent).toContain('Northflank');
  });
});

describe('Agent37 form', () => {
  function renderForm(initialDraft?: Record<string, string>) {
    seed('agent37-setup');
    return render(CloudMachineRow, {
      entry: null,
      newProvider: 'agent37',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
      ...(initialDraft ? { initialDraft } : {}),
    });
  }
  const formOf = (view: ReturnType<typeof render>) =>
    view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
  const configured = () =>
    dispatched().find((action) => action.type === 'cloudMachines/configureRequested')
      ?.payload[0] as Record<string, unknown> | undefined;

  it('starts on a standard sandbox in the US, with sizes before any test', async () => {
    const view = renderForm();
    const form = formOf(view);
    expect(form.getAttribute('data-cloud-provider')).toBe('agent37');
    expect(form.querySelector('[data-agent37-type="default"]')?.getAttribute('data-state')).toBe(
      'on',
    );
    expect(form.querySelector('[data-agent37-region]')).toBeNull();
    expect(form.querySelector('[data-cloud-sizes-unknown]')).toBeNull();
    expect(form.querySelector('[data-agent37-type-note]')?.textContent?.trim()).toBeTruthy();
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await fireEvent.input(form.querySelector('input[type="password"]')!, {
      target: { value: 'sk_live_test' },
    });
    expect(save.disabled).toBe(false);
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({
      provider: 'agent37',
      apiKey: 'sk_live_test',
      instanceType: 'default',
      region: 'us',
      size: '4x8',
    });
  });

  it('asks for a region only for a full VM, and sends the one picked', async () => {
    const view = renderForm({ apiKey: 'sk_live_test' });
    const form = formOf(view);
    const standardNote = form.querySelector('[data-agent37-type-note]')?.textContent;
    await fireEvent.click(form.querySelector('[data-agent37-type="vm"]')!);
    await vi.waitFor(() => expect(form.querySelector('[data-agent37-region]')).not.toBeNull());
    expect(form.querySelector('[data-agent37-type-note]')?.textContent).not.toBe(standardNote);
    const regions = [...form.querySelectorAll('[data-agent37-region-option]')].map((item) =>
      item.textContent?.trim(),
    );
    expect(regions).toEqual(['US', 'Europe (France or UK)', 'Mumbai']);
    await fireEvent.click(form.querySelector('[data-agent37-region-option="ap-south"]')!);
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ instanceType: 'vm', region: 'ap-south' });
  });

  it('goes back to the US when a full VM in another region becomes a standard sandbox', async () => {
    const view = renderForm({ apiKey: 'sk_live_test', instanceType: 'vm', region: 'eu' });
    const form = formOf(view);
    expect(
      form.querySelector('[data-agent37-region-option="eu"]')?.getAttribute('data-state'),
    ).toBe('on');
    await fireEvent.click(form.querySelector('[data-agent37-type="default"]')!);
    await vi.waitFor(() => expect(form.querySelector('[data-agent37-region]')).toBeNull());
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ instanceType: 'default', region: 'us' });
  });

  it('sends no type or region from the edit form when they are unchanged', async () => {
    seed('agent37-providers');
    const view = render(CloudMachineRow, {
      entry: AGENT37_ENTRY,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = formOf(view);
    expect(
      form.querySelector('[data-agent37-region-option="ap-south"]')?.getAttribute('data-state'),
    ).toBe('on');
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ cloudMachineId: AGENT37_ENTRY.id });
    expect(configured()).not.toHaveProperty('instanceType');
    expect(configured()).not.toHaveProperty('region');
  });

  it("explains a refused key in plain words, naming Agent37's IP allowlist", () => {
    seed('agent37-setup-error');
    const view = render(CloudMachineRow, {
      entry: null,
      newProvider: 'agent37',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const error = view.container.querySelector('[data-cloud-key-error]')?.textContent ?? '';
    expect(error).toContain('Agent37');
    expect(error).toContain('IP allowlist');
    expect(error).not.toContain('403');
  });

  it('shows the type and region of an Agent37 entry and lists its instances', () => {
    seed('agent37-providers');
    const view = render(DevicesSettings);
    const row = view.container.querySelector(
      `[data-cloud-machine-row="${AGENT37_ENTRY.id}"]`,
    ) as HTMLElement;
    expect(row.getAttribute('data-cloud-provider')).toBe('agent37');
    expect(row.textContent).toContain('Agent37');
    expect(row.textContent).toContain('Full VM');
    expect(row.textContent).toContain('Mumbai');
    const list = row.querySelector('[data-cloud-sandboxes]');
    expect(list?.getAttribute('aria-label')).toBe('Agent37 instances');
    expect(list?.textContent).toContain('Docker image builder');
    expect(list?.textContent).not.toContain('E2B');
  });
});

describe('Disk setting', () => {
  function renderNew(
    state: CloudMachinesPreviewState,
    provider: 'e2b' | 'northflank' | 'agent37' | 'vercel',
  ) {
    seed(state);
    const view = render(CloudMachineRow, {
      entry: null,
      newProvider: provider,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
      initialDraft: { apiKey: 'secret', projectId: 'intent-agents' },
    });
    return view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
  }
  const disk = (form: HTMLFormElement) =>
    form.querySelector('input[data-cloud-disk]') as HTMLInputElement | null;
  const configured = () =>
    dispatched().find((action) => action.type === 'cloudMachines/configureRequested')
      ?.payload[0] as Record<string, unknown> | undefined;

  it('starts a new Northflank entry at the default disk and sends a changed one', async () => {
    const form = renderNew('northflank-setup', 'northflank');
    expect(disk(form)?.value).toBe('20');
    expect(form.querySelector('[data-cloud-disk-note]')?.textContent).toContain('new machines');
    await fireEvent.input(disk(form)!, { target: { value: '250' } });
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ provider: 'northflank', diskGiB: 250 });
  });

  it('refuses a disk outside the limits and does not save', async () => {
    const form = renderNew('northflank-setup', 'northflank');
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await fireEvent.input(disk(form)!, { target: { value: '501' } });
    expect(form.querySelector('[data-cloud-disk-error]')?.textContent).toContain('6');
    expect(form.querySelector('[data-cloud-disk-error]')?.textContent).toContain('500');
    expect(save.disabled).toBe(true);
    await fireEvent.input(disk(form)!, { target: { value: '5' } });
    expect(save.disabled).toBe(true);
    await fireEvent.input(disk(form)!, { target: { value: '6' } });
    expect(form.querySelector('[data-cloud-disk-error]')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it('lowers an Agent37 disk to the largest the size allows when the type changes, and says so', async () => {
    const form = renderNew('agent37-setup', 'agent37');
    const note = () => form.querySelector('[data-cloud-disk-note]')?.textContent ?? '';
    expect(note()).toContain('4–20 GiB');
    await fireEvent.click(form.querySelector('[data-agent37-type="vm"]')!);
    await vi.waitFor(() => expect(note()).toContain('4–100 GiB'));
    await fireEvent.input(disk(form)!, { target: { value: '60' } });
    expect(form.querySelector('[data-cloud-disk-clamped]')).toBeNull();
    await fireEvent.click(form.querySelector('[data-agent37-type="default"]')!);
    await vi.waitFor(() => expect(disk(form)?.value).toBe('20'));
    expect(form.querySelector('[data-cloud-disk-clamped]')?.textContent).toContain('20 GiB');
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ instanceType: 'default', diskGiB: 20 });
  });

  it('shows no disk field for E2B or Vercel', () => {
    expect(disk(renderNew('vercel-setup', 'vercel'))).toBeNull();
    expect(disk(renderNew('setup', 'e2b'))).toBeNull();
  });

  it('shows no disk field on a backend that reports no disk setting', () => {
    seed('northflank-setup');
    store.dispatch(
      cloudMachinesLoaded({
        supported: true,
        entries: true,
        providerKinds: ['e2b', 'northflank'],
        providers: [],
        machines: [],
        readAt: Date.now(),
      }),
    );
    const view = render(CloudMachineRow, {
      entry: null,
      newProvider: 'northflank',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    expect(view.container.querySelector('input[data-cloud-disk]')).toBeNull();
  });

  it('keeps a saved Agent37 disk above the size cap when the form opens, and saves it unchanged', async () => {
    seed('agent37-providers');
    const entry = {
      ...AGENT37_ENTRY,
      size: '2x4' as const,
      agent37: { instanceType: 'default' as const, region: 'us' as const, diskGiB: 20 },
    };
    const view = render(CloudMachineRow, {
      entry,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    expect(disk(form)?.value).toBe('20');
    expect(form.querySelector('[data-cloud-disk-clamped]')).toBeNull();
    expect(form.querySelector('[data-cloud-disk-error]')).toBeNull();
    expect(form.querySelector('[data-cloud-disk-capped]')?.textContent).toContain('12 GiB');
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await fireEvent.submit(form);
    expect(configured()).not.toHaveProperty('diskGiB');
  });

  it('sends no disk for an entry saved without one while the field shows the default', async () => {
    seed('providers');
    const { diskGiB: _omitted, ...settings } = NORTHFLANK_ENTRY.northflank!;
    const view = render(CloudMachineRow, {
      entry: { ...NORTHFLANK_ENTRY, northflank: settings as typeof NORTHFLANK_ENTRY.northflank },
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    expect(disk(form)?.value).toBe('20');
    await fireEvent.submit(form);
    expect(configured()).not.toHaveProperty('diskGiB');
  });

  it('shows the saved disk of an entry and sends it only when changed', async () => {
    seed('providers');
    const view = render(CloudMachineRow, {
      entry: NORTHFLANK_ENTRY,
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const form = view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
    expect(disk(form)?.value).toBe(String(NORTHFLANK_ENTRY.northflank?.diskGiB));
    await fireEvent.submit(form);
    expect(configured()).not.toHaveProperty('diskGiB');
  });
});

describe('Vercel form', () => {
  function renderForm(entry: typeof VERCEL_ENTRY | null = null) {
    seed(entry ? 'vercel-providers' : 'vercel-setup');
    return render(CloudMachineRow, {
      entry,
      newProvider: 'vercel',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
  }
  const formOf = (view: { container: HTMLElement }) =>
    view.container.querySelector('form[data-cloud-machine-form]') as HTMLFormElement;
  const configured = () =>
    dispatched().find((action) => action.type === 'cloudMachines/configureRequested')
      ?.payload[0] as Record<string, unknown> | undefined;

  it('needs a token, team and project, with sizes and the Hobby session note before a test', async () => {
    const view = renderForm();
    const form = formOf(view);
    expect(form.getAttribute('data-cloud-provider')).toBe('vercel');
    expect(form.querySelector('[data-cloud-sizes-unknown]')).toBeNull();
    expect(form.querySelector('[data-vercel-session-note]')?.textContent).toContain('45');
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await fireEvent.input(form.querySelector('input[type="password"]')!, {
      target: { value: 'vercel_test' },
    });
    await fireEvent.input(form.querySelector('input[data-vercel-team]')!, {
      target: { value: ' team_abc ' },
    });
    expect(save.disabled).toBe(true);
    await fireEvent.input(form.querySelector('input[data-cloud-project]')!, {
      target: { value: 'prj_abc' },
    });
    expect(save.disabled).toBe(false);
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({
      provider: 'vercel',
      apiKey: 'vercel_test',
      teamId: 'team_abc',
      projectId: 'prj_abc',
      size: '4x8',
    });
    expect(configured()).not.toHaveProperty('image');
  });

  it('asks for an own image only on request, focuses it, and sends it', async () => {
    const view = renderForm();
    const form = formOf(view);
    expect(form.querySelector('input[data-vercel-image]')).toBeNull();
    await fireEvent.click(form.querySelector('[data-vercel-image-toggle]')!);
    const image = await vi.waitFor(() => {
      const input = form.querySelector('input[data-vercel-image]') as HTMLInputElement;
      expect(document.activeElement).toBe(input);
      return input;
    });
    await fireEvent.input(form.querySelector('input[type="password"]')!, {
      target: { value: 'vercel_test' },
    });
    await fireEvent.input(form.querySelector('input[data-vercel-team]')!, {
      target: { value: 'team_abc' },
    });
    await fireEvent.input(form.querySelector('input[data-cloud-project]')!, {
      target: { value: 'prj_abc' },
    });
    await fireEvent.input(image, { target: { value: 'acme/images/intent-node' } });
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ image: 'acme/images/intent-node' });
  });

  it('refuses team and project IDs that Vercel would not accept', async () => {
    const view = renderForm();
    const form = formOf(view);
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    await fireEvent.input(form.querySelector('input[type="password"]')!, {
      target: { value: 'vercel_test' },
    });
    await fireEvent.input(form.querySelector('input[data-vercel-team]')!, {
      target: { value: 'acme' },
    });
    await fireEvent.input(form.querySelector('input[data-cloud-project]')!, {
      target: { value: 'prj_abc' },
    });
    expect(form.querySelectorAll('[data-vercel-id-error]')).toHaveLength(1);
    expect(save.disabled).toBe(true);
    await fireEvent.input(form.querySelector('input[data-vercel-team]')!, {
      target: { value: 'team_abc' },
    });
    expect(form.querySelector('[data-vercel-id-error]')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it('refuses an image that is not team/project/repository or a bare repository', async () => {
    const own = {
      ...VERCEL_ENTRY,
      vercel: { ...VERCEL_ENTRY.vercel!, image: 'acme/images/intent-node' },
    };
    const view = renderForm(own);
    const form = formOf(view);
    const save = within(form).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    const image = form.querySelector('input[data-vercel-image]') as HTMLInputElement;
    await fireEvent.input(image, { target: { value: 'acme/images/intent-node:0.212.0' } });
    expect(form.querySelector('[data-vercel-image-error]')).not.toBeNull();
    expect(save.disabled).toBe(true);
    for (const bad of [
      'acme/images/intent-node@sha256:abc',
      'acme/intent-node',
      'vcr.vercel.com/acme/images',
      'acme//intent-node',
    ]) {
      await fireEvent.input(image, { target: { value: bad } });
      expect(save.disabled, bad).toBe(true);
    }
    await fireEvent.input(image, { target: { value: 'intent-node' } });
    expect(save.disabled).toBe(false);
    await fireEvent.input(image, { target: { value: 'acme/images/intent-node' } });
    expect(form.querySelector('[data-vercel-image-error]')).toBeNull();
    expect(save.disabled).toBe(false);
  });

  it('sends no team, project or image from the edit form when they are unchanged', async () => {
    const view = renderForm(VERCEL_ENTRY);
    const form = formOf(view);
    // The public image reads as no image of the entry's own.
    expect(form.querySelector('input[data-vercel-image]')).toBeNull();
    expect((form.querySelector('input[data-vercel-team]') as HTMLInputElement).value).toBe(
      VERCEL_ENTRY.vercel!.teamId,
    );
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ cloudMachineId: VERCEL_ENTRY.id });
    for (const key of ['teamId', 'projectId', 'image', 'apiKey'])
      expect(configured()).not.toHaveProperty(key);
  });

  it('goes back to the public image when an own image is cleared', async () => {
    const own = {
      ...VERCEL_ENTRY,
      vercel: { ...VERCEL_ENTRY.vercel!, image: 'acme/images/intent-node' },
    };
    const view = renderForm(own);
    const form = formOf(view);
    const image = form.querySelector('input[data-vercel-image]') as HTMLInputElement;
    expect(image.value).toBe('acme/images/intent-node');
    await fireEvent.input(image, { target: { value: '' } });
    await fireEvent.submit(form);
    expect(configured()).toMatchObject({ image: '' });
  });

  it('explains that a team or project cannot change while the entry has sandboxes', async () => {
    const view = renderForm(VERCEL_ENTRY);
    store.dispatch(cloudMachineOperationStarted(cloudConfigureKey(VERCEL_ENTRY.id), 'saving'));
    store.dispatch(
      cloudMachineOperationSettled(cloudConfigureKey(VERCEL_ENTRY.id), {
        message: 'raw backend text',
        inUse: true,
      }),
    );
    const error = await vi.waitFor(() => {
      const node = view.container.querySelector('[data-cloud-save-error]');
      expect(node).not.toBeNull();
      return node!.textContent ?? '';
    });
    expect(error).not.toContain('raw backend text');
    expect(error).toContain('sandboxes');
  });

  it('explains a missing project in plain words', () => {
    seed('vercel-setup-error');
    const view = render(CloudMachineRow, {
      entry: null,
      newProvider: 'vercel',
      editing: true,
      onEdit: () => {},
      onClose: () => {},
    });
    const error = view.container.querySelector('[data-cloud-key-error]')?.textContent ?? '';
    expect(error).toContain('Vercel');
    expect(error).toContain('project');
    expect(error).not.toContain('404');
  });

  it('lists the sandboxes of a Vercel entry, with Open Vercel', () => {
    seed('vercel-providers');
    const view = render(DevicesSettings);
    const row = view.container.querySelector(
      `[data-cloud-machine-row="${VERCEL_ENTRY.id}"]`,
    ) as HTMLElement;
    expect(row.getAttribute('data-cloud-provider')).toBe('vercel');
    const list = row.querySelector('[data-cloud-sandboxes]');
    expect(list?.getAttribute('aria-label')).toBe('Vercel sandboxes');
    expect(list?.textContent).toContain('Preview deployer');
    expect(list?.querySelector('a[href="https://vercel.com/dashboard"]')).not.toBeNull();
  });
});
