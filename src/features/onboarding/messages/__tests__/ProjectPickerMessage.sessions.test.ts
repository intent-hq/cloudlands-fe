/**
 * @vitest-environment jsdom
 *
 * Onboarding → Sessions: the tab shows only on hosts with `sessionImport: 1`,
 * lists sessions only once it opens, and a picked session selects its codebase
 * (`repoRoot`) and its last branch, carrying the import in the selection.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  resolveBranch: vi.fn(async (_root: string, branch?: string) => branch ?? null),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(async () => undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$features/session-import/session-base-branch', () => ({
  resolveSessionBaseBranch: mocks.resolveBranch,
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { store as appStore } from '$store/renderer/store';
import {
  importableSessionsLoaded,
  importableSessionsRequested,
  importableSessionsReset,
} from '$store/renderer/slices/importable-sessions/importable-sessions-slice';
import { m } from '$shared/paraglide/messages.js';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import ProjectPickerMessage, { type ProjectSelection } from '../ProjectPickerMessage.svelte';

const session = {
  provider: 'claude-code',
  sessionId: '6eca79e3',
  title: 'Cloudflare account installation',
  cwd: '/work/ember/apps/web',
  updatedAt: '2026-11-12T10:00:00.000Z',
  gitBranch: 'openid-sign-in',
  repoRoot: '/work/ember',
};

let dispatchSpy: ReturnType<typeof vi.spyOn>;
const requests = () =>
  dispatchSpy.mock.calls.filter(
    ([action]) => (action as { type: string }).type === importableSessionsRequested.type,
  );

beforeAll(() => {
  appStore.init();
});

beforeEach(() => {
  appStore.dispatch(importableSessionsReset());
  dispatchSpy = vi.spyOn(appStore, 'dispatch');
  mocks.resolveBranch.mockClear();
});

afterEach(() => {
  cleanup();
  dispatchSpy.mockRestore();
});

describe('ProjectPickerMessage — Sessions tab', () => {
  it('hides the tab on a host without session import', () => {
    admitLegacyPrincipal('owner');
    render(ProjectPickerMessage, { props: {} });
    expect(screen.queryByRole('tab', { name: m.sessionImport_tab_label() })).toBeNull();
  });

  it('lists only once the tab opens, and a pick selects the session codebase', async () => {
    admitLegacyPrincipal('owner', { sessionImport: 1 });
    const selections: ProjectSelection[] = [];
    render(ProjectPickerMessage, { props: { onProjectChange: (s) => selections.push(s) } });
    expect(requests()).toHaveLength(0);

    await fireEvent.click(screen.getByRole('tab', { name: m.sessionImport_tab_label() }));
    const tab = await screen.findByTestId('import-session-tab');
    await waitFor(() => expect(requests()).toHaveLength(1));
    expect(selections.at(-1)?.isValid).toBe(false);

    appStore.dispatch(importableSessionsLoaded('', [session]));
    const row = await within(tab).findByRole('option');
    await fireEvent.pointerUp(row, { pointerType: 'mouse', button: 0 });

    await waitFor(() => expect(selections.at(-1)?.isValid).toBe(true));
    expect(mocks.resolveBranch).toHaveBeenCalledWith('/work/ember', 'openid-sign-in');
    expect(selections.at(-1)).toMatchObject({
      type: 'local',
      repoPath: '/work/ember',
      branch: 'openid-sign-in',
      importSession: { provider: 'claude-code', sessionId: '6eca79e3', repoRoot: '/work/ember' },
    });
    expect(screen.getByTestId('onboarding-import-session-note')).toBeTruthy();
  });
});
