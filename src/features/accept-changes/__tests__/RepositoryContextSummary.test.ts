import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/svelte';
import { initAppStore, store } from '$store/renderer/store';
import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
import {
  repositoryContextDemanded,
  repositoryContextDemandEnded,
} from '$store/renderer/slices/repository-context/repository-context-slice';
import { warmImport } from '../../../test/warm-import';
import {
  installSummaryFixture,
  summaryContext,
  previewWorkspaceId,
  type SummaryScene,
} from '../components/repository-context-summary.preview-fixtures';
import type { RepositoryRootIdentity } from '$shared/types/repository-context';

warmImport(() => import('../components/RepositoryContextSummary.svelte'));
const primary: RepositoryRootIdentity = { workspaceId: previewWorkspaceId, kind: 'primary' };
let disposeStore: () => void;
let fixture: ReturnType<typeof installSummaryFixture>;

beforeEach(() => {
  const context = initAppStore(store);
  disposeStore = context.dispose;
});
afterEach(() => {
  cleanup();
  fixture?.dispose();
  disposeStore();
  vi.restoreAllMocks();
});

async function mount(scene: SummaryScene = 'self-managed', delayCapture = false) {
  fixture = installSummaryFixture(scene, delayCapture);
  const component = (await import('../components/RepositoryContextSummary.svelte')).default;
  return render(component, { root: primary });
}
async function open() {
  await fireEvent.click(screen.getByRole('button', { name: 'Repository details' }));
}
async function ready() {
  await screen.findByText('feature/details');
}

describe('Repository details with the real root Store/saga/live client and controlled IPC', () => {
  it('reads only on opening, shares one inventory across exact roots and disposes on close', async () => {
    const { rerender } = await mount();
    expect(fixture.captures).toHaveLength(0);
    await open();
    await ready();
    expect(fixture.reads.map(({ method, params }) => ({ method, params }))).toEqual([
      { method: 'workspace.repositoryContext', params: { workspaceId: previewWorkspaceId } },
    ]);
    await rerender({ root: { ...primary, kind: 'registered', gitRootId: 'tools' } });
    expect(await screen.findByText('tools/maintenance')).toBeTruthy();
    expect(screen.queryByText('feature/details')).toBeNull();
    await rerender({ root: { ...primary, kind: 'registered', gitRootId: 'missing' } });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByText('tools/maintenance')).toBeNull();
    expect(screen.queryByText('feature/details')).toBeNull();
    expect(fixture.captures).toHaveLength(1);
    await open();
    await waitFor(() => expect(fixture.releases).toEqual(['preview-route-1']));
    expect(screen.queryByRole('button', { name: 'Read again' })).toBeNull();
  });

  it.each(['github', 'self-managed', 'unknown', 'long'] as const)(
    'shows only eligible canonical facts for %s, never raw URLs, account IDs or write controls',
    async (scene) => {
      await mount(scene);
      await open();
      const expected = summaryContext(scene).roots[0];
      const target = expected.targets[0].target;
      expect(await screen.findByText(target.instanceBaseUrl)).toBeTruthy();
      expect(screen.getByText(target.projectPath)).toBeTruthy();
      if (expected.branch) expect(screen.getByText(expected.branch)).toBeTruthy();
      else expect(screen.getAllByText('Unknown').length).toBe(2);
      const section = screen.getByRole('region', { name: 'Repository details' });
      expect(section.textContent).not.toMatch(
        /fixture-secret|fixture-user|fixture-sha|private-record|private-evidence/,
      );
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      expect(screen.getAllByRole('button')).toHaveLength(2);
      expect(fixture.reads).toHaveLength(1);
    },
  );

  it.each(['history', 'missing-remote', 'selection-required', 'no-remote'] as const)(
    'does not present an unresolved %s as a usable project',
    async (scene) => {
      await mount(scene);
      await open();
      await ready();
      expect(screen.queryByText('engineering/tools/editor')).toBeNull();
      expect(screen.queryByText('https://forge.example:8443/platform/gitlab')).toBeNull();
      if (scene === 'missing-remote') expect(screen.getByText(/upstream-old/)).toBeTruthy();
      expect(screen.queryByText(/Migrated/)).toBeNull();
      expect(fixture.reads).toHaveLength(1);
    },
  );

  it('shows migration only with canonical provenance, without exposing internal proof IDs', async () => {
    await mount('migrated');
    await open();
    await ready();
    expect(screen.getByText(/Migrated/)).toBeTruthy();
    expect(screen.getByText('engineering/tools/editor')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private-evidence');
  });

  it.each(['disconnected', 'disabled', 'unsupported'] as const)(
    'retains an explicit remote and observed %s availability without exposing account metadata',
    async (availability) => {
      await mount('loading');
      await open();
      await waitFor(() => expect(fixture.reads).toHaveLength(1));
      const context = summaryContext('self-managed');
      const entry = context.roots[0];
      entry.targets[0].availability = availability;
      entry.targets[0].connection = {
        connectionId: 'private-connection',
        accountId: 'private-account',
        connectionGeneration: '1',
      };
      entry.reviewSelection = {
        saved: { mode: 'explicit-remote', remoteName: 'review-upstream' },
        noRemotes: false,
        outcome: { state: 'resolved', target: entry.targets[0].target, source: 'explicit-remote' },
      };
      fixture.reads[0].finish(context);
      await ready();
      expect(screen.getByText(/review-upstream/)).toBeTruthy();
      expect(screen.getByText(new RegExp(`^${availability}$`, 'i'))).toBeTruthy();
      expect(screen.getByText('engineering/tools/editor')).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/private-connection|private-account/);
      expect(fixture.captures).toHaveLength(1);
    },
  );

  it('clears a retired result and starts a fresh lifetime only after Read again', async () => {
    await mount();
    await open();
    await ready();
    fixture.retire();
    await waitFor(() => expect(screen.queryByText('engineering/tools/editor')).toBeNull());
    expect(fixture.captures).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await ready();
    expect(fixture.captures).toHaveLength(2);
    expect(fixture.releases).toEqual(['preview-route-1']);
  });

  it('ends with the original admission across an equal-ID host replacement and never replays the read', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    await mount();
    await open();
    await ready();
    const demanded = () =>
      dispatch.mock.calls
        .map(([action]) => action)
        .filter(
          (action): action is ReturnType<typeof repositoryContextDemanded> =>
            action.type === repositoryContextDemanded.type,
        );
    const begin = demanded()[0];
    fixture.admit('local-B');
    await waitFor(() => expect(screen.queryByText('engineering/tools/editor')).toBeNull());
    expect(fixture.captures).toHaveLength(1);
    expect(
      dispatch.mock.calls.some(
        ([action]) =>
          action.type === repositoryContextDemandEnded.type &&
          JSON.stringify(action.payload) === JSON.stringify(begin.payload),
      ),
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await ready();
    const begins = demanded();
    expect(begins[1].payload[1]).not.toBe(begin.payload[1]);
    expect(begins[1].payload[2]).not.toBe(begin.payload[2]);
  });

  it('does not admit an initially null demand when admission later appears', async () => {
    await mount('inactive');
    await open();
    expect(selectPrincipalAdmissionContext.select(store.state)).toBeNull();
    fixture.admit('host-A');
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(fixture.captures).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await ready();
    expect(fixture.captures).toHaveLength(1);
  });

  it('keeps an unavailable result until explicit retry and disposes it on unmount', async () => {
    const { unmount } = await mount('unavailable');
    await open();
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(fixture.captures).toHaveLength(1);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Read again' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(fixture.releases).toHaveLength(2));
    unmount();
    expect(Object.keys(store.state.repositoryContext.byWorkspaceId)).toHaveLength(0);
  });

  it('releases a late capture after unmount without issuing a read', async () => {
    const { unmount } = await mount('self-managed', true);
    await open();
    expect(fixture.captures).toHaveLength(1);
    unmount();
    fixture.captures[0].finish();
    await waitFor(() => expect(fixture.releases).toEqual(['preview-route-1']));
    expect(fixture.reads).toHaveLength(0);
  });

  it('drops a late response after a workspace change without reading the replacement', async () => {
    const { rerender } = await mount('loading');
    await open();
    await waitFor(() => expect(fixture.reads).toHaveLength(1));
    await rerender({ root: { workspaceId: 'another-workspace', kind: 'primary' } });
    fixture.reads[0].finish();
    await waitFor(() => expect(fixture.releases).toHaveLength(1));
    expect(screen.queryByText('feature/details')).toBeNull();
    expect(fixture.captures).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(fixture.reads).toHaveLength(2));
    fixture.reads[1].finish();
    await ready();
    expect(fixture.reads[1].params).toEqual({ workspaceId: 'another-workspace' });
  });
  it('selection is explicit and independent of the one read demand across root switches and collapse', async () => {
    fixture = installSummaryFixture('selection-edit');
    const Component = (await import('../components/RepositoryContextSummary.svelte')).default;
    const { rerender } = render(Component, { root: primary });
    await open();
    await ready();
    expect(fixture.selectionCaptures).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await screen.findByRole('combobox', { name: 'Review choice' });
    await rerender({ root: { ...primary, kind: 'registered', gitRootId: 'tools' } });
    await waitFor(() => expect(fixture.selectionReleases).toEqual(['preview-selection-1']));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(fixture.captures).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit review repository' }));
    await screen.findByRole('combobox', { name: 'Review choice' });
    expect(fixture.selectionCaptures[1].root).toEqual({
      ...primary,
      kind: 'registered',
      gitRootId: 'tools',
    });
    await open();
    await waitFor(() => expect(fixture.selectionReleases).toHaveLength(2));
    expect(fixture.selectionRequests).toHaveLength(0);
  });
});
