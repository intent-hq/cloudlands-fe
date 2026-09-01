/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
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

const local: ConnectionRecord = {
  id: LOCAL_CONNECTION_ID,
  label: 'This machine (local)',
  host: null,
  port: null,
  fingerprint: null,
  isLocal: true,
};

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
    git: {
      hasRepository: true,
      branch: 'main',
      dirtyFiles: ['src/x.ts'],
      sandboxBranches: ['sb/agent-1'],
    },
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

  it('renders a local entry with the laptop icon as a selectable destination', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onSelectDestination = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'destination',
        connections: [local, remote('conn-2', '10.0.0.3')],
        onSelectDestination,
      },
    });

    const localOption = screen.getByTestId(`transfer-server-${LOCAL_CONNECTION_ID}`);
    expect(localOption.textContent).toContain('This machine (local)');
    expect(localOption.querySelector('.fa-icon')?.getAttribute('data-icon')).toBe('laptop');
    // Remotes keep the server icon.
    expect(
      screen
        .getByTestId('transfer-server-conn-2')
        .querySelector('.fa-icon')
        ?.getAttribute('data-icon'),
    ).toBe('server');

    await fireEvent.click(localOption);
    expect(onSelectDestination).toHaveBeenCalledWith({
      kind: 'server',
      connectionId: LOCAL_CONNECTION_ID,
    });
  });

  it('option rows are not height-constrained so two-line labels render fully', async () => {
    // Regression: Button's default size pins h-8 (32px) and the plain variant's
    // !px-0/!py-0 win over the intended padding, clipping the download option's
    // second line at the bottom edge; whitespace-nowrap kept long locale
    // subtitles from wrapping. optionClass must resolve all three away.
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'destination',
        connections: [remote('conn-1', '10.0.0.2')],
      },
    });

    for (const testId of ['transfer-download-option', 'transfer-server-conn-1']) {
      const className = screen.getByTestId(testId).className;
      expect(className).toContain('h-auto');
      expect(className).not.toMatch(/\bh-\d/);
      expect(className).not.toMatch(/\bsize-\d/);
      expect(className).toContain('whitespace-normal');
      expect(className).not.toContain('whitespace-nowrap');
      expect(className).not.toContain('!px-0');
      expect(className).not.toContain('!py-0');
    }
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
    // Server mode keeps the transfer-flavored copy and CTA.
    expect(screen.getByText('Review what will be transferred.')).toBeTruthy();
    expect(screen.getByText(/Estimated transfer size/)).toBeTruthy();
    // Start button is enabled once the plan is loaded.
    const start = screen.getByTestId('transfer-start-button') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    expect(start.textContent).toContain('Start transfer');
  });

  it('download mode swaps the copy and CTA for download wording', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'confirm',
        destination: { kind: 'download' },
        planStatus: 'loaded',
        plan,
      },
    });

    expect(screen.getByText('Review what will be included in the download.')).toBeTruthy();
    expect(screen.getByText('Estimated download size')).toBeTruthy();
    expect(screen.getByText(/are not included in the archive/)).toBeTruthy();
    expect(screen.queryByText(/Estimated transfer size/)).toBeNull();
    const start = screen.getByTestId('transfer-start-button') as HTMLButtonElement;
    expect(start.textContent).toContain('Start download');
    expect(start.textContent).not.toContain('Start transfer');
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

  it('Start transfer fires onStart; disabled while the plan is loading', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onStart = vi.fn();

    const { unmount } = render(TransferWorkspaceModal, {
      props: { open: true, step: 'confirm', planStatus: 'loading', onStart },
    });
    expect((screen.getByTestId('transfer-start-button') as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(TransferWorkspaceModal, {
      props: { open: true, step: 'confirm', planStatus: 'loaded', plan, onStart },
    });
    await fireEvent.click(screen.getByTestId('transfer-start-button'));
    expect(onStart).toHaveBeenCalled();
  });
});

describe('TransferWorkspaceModal — transferring step', () => {
  it('renders build stage, then relay byte counters against the estimate', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    const { unmount } = render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'transferring',
        connections: [remote('conn-1', '10.0.0.2')],
        destination: { kind: 'server', connectionId: 'conn-1' },
        plan,
        runStatus: 'running',
        progress: {
          phase: 'building',
          stage: 'bundling-git',
          bytesDown: 0,
          bytesUp: 0,
          chunksDone: 0,
        },
      },
    });
    expect(screen.getByTestId('transfer-progress-stage').textContent).toContain(
      'Bundling git repository',
    );
    // Building: no fraction yet (indeterminate bar).
    expect(screen.getByTestId('transfer-progress-bar').getAttribute('aria-valuenow')).toBeNull();
    unmount();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'transferring',
        connections: [remote('conn-1', '10.0.0.2')],
        destination: { kind: 'server', connectionId: 'conn-1' },
        plan,
        runStatus: 'running',
        progress: {
          phase: 'relaying',
          bytesTotal: 4 * 1024 * 1024,
          bytesDown: 2 * 1024 * 1024,
          bytesUp: 1024 * 1024,
          chunksTotal: 4,
          chunksDone: 1,
        },
      },
    });
    expect(screen.getByTestId('transfer-progress-label').textContent).toContain(
      'Transferring “My Space”',
    );
    expect(screen.getByTestId('transfer-progress-stage').textContent).toContain(
      'Transferring archive',
    );
    const bytes = screen.getByTestId('transfer-progress-bytes').textContent ?? '';
    expect(bytes).toContain('Downloaded: 2Mi');
    expect(bytes).toContain('Uploaded: 1Mi');
    // (2 + 1) MiB of 2×4 MiB → 38%.
    expect(screen.getByTestId('transfer-progress-bar').getAttribute('aria-valuenow')).toBe('38');
    // Restart toggle only renders for server destinations.
    expect(screen.getByTestId('transfer-restart-agents')).toBeTruthy();
  });

  it('hides the upload counter and restart toggle for downloads, with download copy', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'transferring',
        destination: { kind: 'download' },
        plan,
        runStatus: 'running',
        progress: {
          phase: 'relaying',
          bytesTotal: 4 * 1024 * 1024,
          bytesDown: 1024 * 1024,
          bytesUp: 0,
          chunksTotal: 4,
          chunksDone: 1,
        },
      },
    });
    expect(screen.getByTestId('transfer-progress-label').textContent).toContain(
      'Downloading “My Space”',
    );
    expect(screen.getByTestId('transfer-progress-stage').textContent).toContain(
      'Downloading archive',
    );
    expect(screen.getByTestId('transfer-progress-bar').getAttribute('aria-label')).toBe(
      'Download progress',
    );
    const bytes = screen.getByTestId('transfer-progress-bytes').textContent ?? '';
    expect(bytes).toContain('Downloaded: 1Mi');
    expect(bytes).not.toContain('Uploaded');
    expect(screen.queryByTestId('transfer-restart-agents')).toBeNull();
    // Download fraction counts down only: 1 of 4 MiB → 25%.
    expect(screen.getByTestId('transfer-progress-bar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('forwards the restart-agents toggle', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onSetRestartAgents = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'transferring',
        connections: [remote('conn-1', '10.0.0.2')],
        destination: { kind: 'server', connectionId: 'conn-1' },
        runStatus: 'running',
        restartAgents: false,
        onSetRestartAgents,
      },
    });

    const toggle = screen.getByRole('button', {
      name: 'Restart in-flight agents on the destination',
    });
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle);
    expect(onSetRestartAgents).toHaveBeenCalledWith(true);
  });
});

describe('TransferWorkspaceModal — result step', () => {
  it('success (server): archive Toggle, Done and Open buttons', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onFinalize = vi.fn();
    const onSetArchiveSource = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'My Space',
        step: 'result',
        connections: [remote('conn-1', '10.0.0.2')],
        destination: { kind: 'server', connectionId: 'conn-1' },
        runStatus: 'succeeded',
        restartAgents: true,
        interruptedAgents: ['agent-1', 'agent-2'],
        archiveSource: true,
        onFinalize,
        onSetArchiveSource,
      },
    });

    expect(screen.getByTestId('transfer-result-success').textContent).toContain(
      'Transfer complete',
    );
    expect(screen.getByTestId('transfer-result-interrupted').textContent).toContain('2');
    expect(screen.getByTestId('transfer-archive-source')).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Archive the source workspace' });
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(toggle);
    expect(onSetArchiveSource).toHaveBeenCalledWith(false);

    await fireEvent.click(screen.getByTestId('transfer-open-button'));
    expect(onFinalize).toHaveBeenCalledWith(true);
    await fireEvent.click(screen.getByTestId('transfer-done-button'));
    expect(onFinalize).toHaveBeenCalledWith(false);
  });

  it('success (download): saved-archive copy and path, no archive Toggle, no open button', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'download' },
        runStatus: 'succeeded',
        downloadFilePath: '/tmp/ws-1-transfer.zip',
      },
    });

    expect(screen.getByTestId('transfer-result-success').textContent).toContain(
      'Download complete',
    );
    expect(screen.getByTestId('transfer-result-file').textContent).toContain(
      'Archive saved to /tmp/ws-1-transfer.zip',
    );
    expect(screen.queryByTestId('transfer-archive-source')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive the source workspace' })).toBeNull();
    expect(screen.queryByTestId('transfer-open-button')).toBeNull();
    expect(screen.getByTestId('transfer-done-button')).toBeTruthy();
  });

  it('failure (download): download-flavored title and reason', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'download' },
        runStatus: 'failed',
        runError: 'disk full',
      },
    });

    expect(screen.getByTestId('transfer-result-failed').textContent).toContain('Download failed');
    expect(screen.getByTestId('transfer-failed-reason').textContent).toContain(
      'The download did not complete: disk full',
    );
  });

  it('post-export failure warns that source agents were stopped and offers Retry', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onRetry = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'server', connectionId: 'conn-1' },
        runStatus: 'failed',
        runError: 'versions must match exactly',
        failurePhase: 'post-export',
        onRetry,
      },
    });

    expect(screen.getByTestId('transfer-result-failed')).toBeTruthy();
    expect(screen.getByTestId('transfer-failed-reason').textContent).toContain(
      'versions must match exactly',
    );
    expect(screen.getByTestId('transfer-failed-reason').textContent).toContain(
      'its agents were stopped',
    );
    await fireEvent.click(screen.getByTestId('transfer-retry-button'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('preflight failure says source agents were not stopped', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'server', connectionId: 'conn-1' },
        runStatus: 'failed',
        runError: 'destination unavailable',
        failurePhase: 'preflight',
      },
    });

    const reason = screen.getByTestId('transfer-failed-reason').textContent;
    expect(reason).toContain('destination unavailable');
    expect(reason).toContain('agents were not stopped');
  });

  it('finalize failure renders inline error', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'server', connectionId: 'conn-1' },
        connections: [remote('conn-1', '10.0.0.2')],
        runStatus: 'succeeded',
        finalizeStatus: 'error',
        finalizeError: 'workspace gone',
      },
    });

    expect(screen.getByTestId('transfer-finalize-error').textContent).toContain('workspace gone');
  });

  it('locks closing while finalize is running', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onCancel = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'server', connectionId: 'conn-1' },
        connections: [remote('conn-1', '10.0.0.2')],
        runStatus: 'succeeded',
        finalizeStatus: 'running',
        onCancel,
      },
    });

    const closeButton = screen.getByLabelText('Close') as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    await fireEvent.click(closeButton);
    await fireEvent.click(screen.getByRole('presentation'));
    await fireEvent.keyDown(screen.getByRole('presentation'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('close stays available when finalize is not running', async () => {
    const TransferWorkspaceModal = (await import('../TransferWorkspaceModal.svelte')).default;
    const onCancel = vi.fn();

    render(TransferWorkspaceModal, {
      props: {
        open: true,
        step: 'result',
        destination: { kind: 'server', connectionId: 'conn-1' },
        connections: [remote('conn-1', '10.0.0.2')],
        runStatus: 'succeeded',
        finalizeStatus: 'idle',
        onCancel,
      },
    });

    await fireEvent.click(screen.getByLabelText('Close'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
