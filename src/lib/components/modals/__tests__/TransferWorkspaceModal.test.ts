/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import type { ConnectionRecord } from '$store/renderer/slices/connections/connections-types';
import type { TransferPlan } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

warmImport(() => import('../../workspace/sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../TransferWorkspaceModal.svelte'));

const remote = (id: string, host: string): ConnectionRecord => ({
  id,
  label: `${host}:5181`,
  host,
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
});

const plan: TransferPlan = {
  manifest: {
    formatVersion: 1,
    creatingIntentdVersion: '0.9.0',
    workspaceId: 'ws-1',
    createdAt: '2026-08-11T00:00:00Z',
    tables: [
      { name: 'note', rowCount: 12, approxBytes: 4096 },
      { name: 'task', rowCount: 0, approxBytes: 0 },
    ],
    assets: [{ id: 'a.png', sizeBytes: 2048 }],
    git: { hasRepository: true, branch: 'main', dirtyFiles: ['src/x.ts'], sandboxBranches: ['sb/agent-1'] },
  },
  totalSizeBytes: 3 * 1024 * 1024,
  dbRowBytes: 4096,
  assetBytes: 2048,
  estimatedGitBundleBytes: 2 * 1024 * 1024,
  warnings: [
    { code: 'agents-running', message: '2 agent(s) are running or starting; they will be stopped' },
    { code: 'uncommitted-changes', message: '1 uncommitted file(s) will be snapshotted' },
  ],
};

describe('TransferWorkspaceModal — destination step', () => {
  it('lists target servers and the download option; Next disabled until a pick', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onSelectDestination = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'destination',
        connections: [remote('conn-1', '10.0.0.2')],
        onSelectDestination,
      },
    });

    expect(screen.getByText('10.0.0.2:5181')).toBeTruthy();
    expect(screen.getByText('Download to file')).toBeTruthy();
    expect(screen.queryByTestId('transfer-empty-servers')).toBeNull();
    expect((screen.getByText('Next') as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(screen.getByTestId('transfer-server-conn-1'));
    expect(onSelectDestination).toHaveBeenCalledWith({ kind: 'server', connectionId: 'conn-1' });

    await fireEvent.click(screen.getByTestId('transfer-download-option'));
    expect(onSelectDestination).toHaveBeenCalledWith({ kind: 'download' });
  });

  it('shows the empty-server explainer while download stays available', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: { open: true, workspaceTitle: 'My Space', step: 'destination', connections: [] },
    });

    expect(screen.getByTestId('transfer-empty-servers')).toBeTruthy();
    expect(screen.getByTestId('transfer-download-option')).toBeTruthy();
  });

  it('enables Next once a destination is picked and forwards onNext', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onNext = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'destination',
        connections: [],
        destination: { kind: 'download' },
        onNext,
      },
    });

    const next = screen.getByText('Next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    await fireEvent.click(next);
    expect(onNext).toHaveBeenCalled();
  });
});

describe('TransferWorkspaceModal — confirm step', () => {
  it('renders manifest counts, sizes, git summary, warnings, and exclusions note', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'confirm',
        connections: [remote('conn-1', '10.0.0.2')],
        destination: { kind: 'server', connectionId: 'conn-1' },
        planStatus: 'loaded',
        plan,
      },
    });

    expect(screen.getByTestId('transfer-destination-summary').textContent).toContain(
      '10.0.0.2:5181',
    );
    expect(screen.getByTestId('transfer-total-size').textContent).toContain('3Mi');
    // Only populated tables render (task has 0 rows).
    expect(screen.getByText('note')).toBeTruthy();
    expect(screen.queryByText('task')).toBeNull();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('Branch: main')).toBeTruthy();
    expect(screen.getByText('1 sandbox branch included')).toBeTruthy();
    expect(screen.getByText(/they will be stopped/)).toBeTruthy();
    expect(screen.getByText(/will be snapshotted/)).toBeTruthy();
    expect(screen.getByText(/Event history, terminal sessions/)).toBeTruthy();
    expect(screen.getByTestId('transfer-coming-soon')).toBeTruthy();
  });

  it('shows the loading and error states', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    const { unmount } = render(TransferWorkspaceModal, {
      props: { open: true, step: 'confirm', planStatus: 'loading' },
    });
    expect(screen.getByTestId('transfer-plan-loading')).toBeTruthy();
    unmount();

    render(TransferWorkspaceModal, {
      props: { open: true, step: 'confirm', planStatus: 'error', planError: 'daemon unavailable' },
    });
    expect(screen.getByTestId('transfer-plan-error').textContent).toContain('daemon unavailable');
  });

  it('Back returns to the destination step via onBack', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onBack = vi.fn();

    render(TransferWorkspaceModal, {
      props: { open: true, step: 'confirm', planStatus: 'loaded', plan, onBack },
    });

    await fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
  });
});
