/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { settingsFormSaga } from '$store/renderer/slices/settings-events/sagas/settings-form-saga';
import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  principalContextChanged,
  principalReceived,
} from '$store/renderer/slices/principal/principal-slice';
import {
  settingsFormOpened,
  settingsFormLoadRequested,
  settingsFormSaveRequested,
} from '$store/renderer/slices/settings-events/settings-events-slice';
import {
  selectSettingsFormEntry,
  selectSettingsFormOperation,
} from '$store/renderer/slices/settings-events/settings-events-selectors';
import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
import CollaborationMachineNameSettings from './CollaborationMachineNameSettings.svelte';
import GuestSessionsSettings from './GuestSessionsSettings.svelte';

const wire = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: wire.request }));
const path = 'sharing.machineName';
let saved = '';
let stop: () => void;
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function context() {
  return selectPrincipalActionContext.select(appStore.state)!;
}
function mount() {
  return render(CollaborationMachineNameSettings, { props: { context: context() } });
}
function role(value: 'owner' | 'member' | 'guest') {
  const { principal } = withHostPrincipal(appStore.state, value);
  appStore.dispatch(
    principalReceived(
      {
        context: principal.context!,
        invalidation: principal.invalidation,
        presentationVersion: principal.presentationVersion,
      },
      principal.snapshot!,
    ),
  );
}
beforeEach(() => {
  appStore.init();
  appStore.dispatch(setLabsMultiplayerEnabled(true));
  admitLegacyPrincipal();
  saved = '';
  wire.request.mockReset();
  wire.request.mockImplementation(async (method, params) => {
    if (method === 'settings.get')
      return { value: saved, definition: { path, type: 'string', defaultValue: '' } };
    if (method === 'system.status')
      return {
        hostname: 'studio.local',
        prettyHostname: 'Studio',
        collaborationName: saved || null,
      };
    if (method === 'settings.update') {
      saved = params.changes[0].value;
      return { applied: [{ path, value: saved }] };
    }
    throw new Error('Unexpected wire request');
  });
  stop = appStore.runSaga(settingsFormSaga);
});
afterEach(() => {
  cleanup();
  stop();
  appStore.dispose();
});

it('loads, saves on the connected host, reloads persisted name, and resets to friendly hostname', async () => {
  let view = mount();
  const input = await screen.findByRole('textbox', { name: 'Machine name' });
  await waitFor(() => expect(input).toHaveProperty('disabled', false));
  expect(wire.request).toHaveBeenCalledWith('settings.get', { path });
  expect(wire.request).toHaveBeenCalledWith('system.status');
  expect(input).toHaveProperty('placeholder', 'Studio');
  await fireEvent.input(input, { target: { value: '  Team studio  ' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(input).toHaveProperty('value', 'Team studio'));
  expect(wire.request).toHaveBeenCalledWith('settings.update', {
    changes: [{ path, value: 'Team studio' }],
  });
  view.unmount();
  view = mount();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'Team studio'));
  await fireEvent.click(screen.getByRole('button', { name: 'Use default name' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', ''));
  expect(wire.request).toHaveBeenLastCalledWith('settings.update', {
    changes: [{ path, value: '' }],
  });
  expect(screen.getByRole('textbox')).toHaveProperty('placeholder', 'Studio');
  view.unmount();
});

it('retains the draft and saved host value after a rejected or unapplied save', async () => {
  saved = 'Original';
  mount();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('value', 'Original'));
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'New name' } });
  wire.request.mockRejectedValueOnce(new Error('Forbidden'));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('Could not save the machine name. Try again.');
  expect(saved).toBe('Original');
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'New name');
  wire.request.mockResolvedValueOnce({ applied: [] });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  expect(saved).toBe('Original');
  expect(screen.queryByText('Machine name saved')).toBeNull();
});

it('confirms a concurrent same-name save from the host when applied is empty', async () => {
  mount();
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('disabled', false));
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Team studio' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  // Another owner window already saved the same value before this request arrived.
  saved = 'Team studio';
  wire.request.mockResolvedValueOnce({ applied: [] });
  await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('Machine name saved');
  expect(wire.request).toHaveBeenLastCalledWith('settings.get', { path });
});

it('retries a failed read and validates Unicode length and control characters before any write', async () => {
  wire.request.mockRejectedValueOnce(new Error('offline'));
  mount();
  await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveProperty('disabled', false));
  for (const value of ['😀'.repeat(101), 'a\u0007b']) {
    await fireEvent.input(screen.getByRole('textbox'), { target: { value } });
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      true,
    );
  }
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: '😀'.repeat(100) } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save', exact: true })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  await fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(saved).toBe('😀'.repeat(100)));
  expect(wire.request.mock.calls.filter(([method]) => method === 'settings.update')).toHaveLength(
    1,
  );
});

for (const nonOwner of ['member', 'guest'] as const) {
  it(`${nonOwner} has no rename control and cannot dispatch an effective save`, async () => {
    role(nonOwner);
    render(GuestSessionsSettings);
    expect(screen.queryByRole('textbox', { name: 'Machine name' })).toBeNull();
    const identity = { formId: 'forged-form', sessionId: context() };
    appStore.dispatch(settingsFormOpened(identity, 'collaboration-machine-name'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, resource: 'load', requestId: 'load' }),
    );
    appStore.dispatch(
      settingsFormSaveRequested({ ...identity, resource: path, requestId: 'save' }, [
        { path, value: 'Forbidden' },
      ]),
    );
    await settle();
    expect(wire.request).not.toHaveBeenCalled();
  });
}

for (const operation of ['load', 'save'] as const) {
  for (const change of ['backend', 'authority'] as const) {
    it(`discards a late ${operation} after ${change} changes and rejects the stale form`, async () => {
      const identity = { formId: 'race', sessionId: context() };
      appStore.dispatch(settingsFormOpened(identity, 'collaboration-machine-name'));
      if (operation === 'save') {
        appStore.dispatch(
          settingsFormLoadRequested({ ...identity, resource: 'load', requestId: 'initial' }),
        );
        await waitFor(() =>
          expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(''),
        );
      }
      let resolve!: (value: unknown) => void;
      wire.request.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const request = {
        ...identity,
        resource: operation === 'load' ? 'load' : path,
        requestId: 'delayed',
      };
      appStore.dispatch(
        operation === 'load'
          ? settingsFormLoadRequested(request)
          : settingsFormSaveRequested(request, [{ path, value: 'Stale' }]),
      );
      await waitFor(() => expect(resolve).toBeTypeOf('function'));
      if (change === 'authority') role('member');
      else appStore.dispatch(principalContextChanged('different-backend'));
      resolve(operation === 'load' ? { value: 'Stale' } : { applied: [{ path, value: 'Stale' }] });
      await settle();
      expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).not.toBe(
        'Stale',
      );
      expect(
        selectSettingsFormOperation.select(appStore.state, identity, request.resource)?.status,
      ).not.toBe('succeeded');
      const calls = wire.request.mock.calls.length;
      appStore.dispatch(
        settingsFormSaveRequested({ ...request, requestId: 'stale-click' }, [
          { path, value: 'Another' },
        ]),
      );
      await settle();
      expect(wire.request).toHaveBeenCalledTimes(calls);
    });
  }
}
