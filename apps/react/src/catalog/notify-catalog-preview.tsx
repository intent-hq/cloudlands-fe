// Source static cells: PatternCatalogPreview.svelte notify branch.
// Interactive caller uses the real notification policy, Sonner callbacks and wall-clock expiry.
// i18n-ignore (internal catalog fixture content)
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AgentAttentionToast, UpdateToast } from '@/components/ui/toast';
import { notify, type NotifyId, type ProgressHandle } from '@/components/patterns/notify';
import { NotifyErrorToast } from '@/components/patterns/notify/notify-error-toast';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

export function NotifyCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  return (
    <div data-pattern-contract="notify" data-catalog-renderer-fixture={fixture.id}>
      {fixture.states.map((state) => (
        <section key={state} data-catalog-rendered-state={state}>
          <NotifyErrorToast
            message={`${state} notification`}
            details="Deterministic catalog details"
          />
        </section>
      ))}
    </div>
  );
}

export function NotifyExample({ policyControls = true }: { policyControls?: boolean }) {
  const owned = useRef(new Set<NotifyId>());
  const progress = useRef<ProgressHandle | null>(null);
  const [progressId, setProgressId] = useState<NotifyId | null>(null);
  const [keyedIds, setKeyedIds] = useState<NotifyId[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [undoId, setUndoId] = useState<NotifyId | null>(null);
  const record = (value: string) => setEvents((previous) => [...previous, value]);
  const keep = (id: NotifyId) => {
    owned.current.add(id);
    return id;
  };
  const callbacks = { onDismiss: () => record('dismiss'), onAutoClose: () => record('auto-close') };
  useEffect(() => {
    const ids = owned.current;
    return () => ids.forEach((id) => notify.dismiss(id));
  }, []);
  const updateAvailable = {
    status: 'available' as const,
    updateInfo: { version: '4.2.0', releaseDate: '2026-09-07', releaseNotes: 'Catalog preview' },
    availableDescription: 'Ready to install · 84 MB',
  };
  const updateDownloading = {
    ...updateAvailable,
    status: 'downloading' as const,
    progress: { percent: 62, bytesPerSecond: 2400000, transferred: 62000000, total: 95600000 },
    remainingSeconds: 14,
  };
  function startProgress() {
    progress.current?.dismiss();
    const handle = notify.progress('Live loading toast', { ...callbacks, key: 'catalog-progress' });
    progress.current = handle;
    keep(handle.id);
    setProgressId(handle.id);
  }
  function startUndo(fail = false) {
    const id = notify.undoable(fail ? 'Failing undo operation' : 'Live undoable toast', {
      ...(policyControls ? { duration: 1200 } : {}),
      undoLabel: 'Undo',
      onUndo: async () => {
        record(fail ? 'undo-failed' : 'undo');
        if (fail) throw new Error('Undo operation failed');
      },
      onExpire: () => record('expired'),
      ...callbacks,
    });
    keep(id);
    setUndoId(id);
  }
  return (
    <section
      className="grid gap-3"
      aria-label="Live toast behavior checks"
      data-functional-example="notify"
    >
      <h3 className="text-sm font-medium">Fire live toasts</h3>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => keep(notify.success('Live success toast', callbacks))}
        >
          Success
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => keep(notify.error('Live error toast', callbacks))}
        >
          Error
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => keep(notify.warning('Live warning toast', callbacks))}
        >
          Warning
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => keep(notify.info('Live info toast', callbacks))}
        >
          Info
        </Button>
        <Button size="sm" variant="outline" onClick={startProgress}>
          Loading
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            keep(
              notify.error(
                { message: 'Live detailed error', details: 'Diagnostic details from catalog' },
                callbacks,
              ),
            )
          }
        >
          Detailed error
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            keep(
              notify.appError(
                {
                  error: {
                    id: 'catalog-live-error',
                    type: 'error',
                    title: 'Workspace error',
                    message: 'The live application error toast is working.',
                    timestamp: new Date(),
                    recoverable: true,
                  },
                  onCopy: () => record('copy'),
                  onDebug: () => record('debug'),
                  onRetry: () => record('retry'),
                },
                callbacks,
              ),
            )
          }
        >
          Application error
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            let id: NotifyId;
            id = keep(
              notify.agentFailure(
                {
                  title: 'Implementor failed',
                  errorSummary: 'Live failure toast',
                  retryLabel: 'Retry Implementor',
                  retrying: false,
                  onRetry: () => record('retry'),
                  onSwitchTo: () => record('switch'),
                  onClose: () => {
                    record('failure-close');
                    notify.dismiss(id);
                  },
                },
                callbacks,
              ),
            );
          }}
        >
          Agent failure
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            let id: NotifyId;
            id = keep(
              notify.custom(AgentAttentionToast, {
                ...callbacks,
                componentProps: {
                  title: 'Coordinator requests a discussion',
                  timestamp: new Date(Date.now() - 18000).toISOString(),
                  reason: 'Live attention toast',
                  kind: 'discussion',
                  onSwitchTo: () => record('switch'),
                  onClose: () => {
                    record('attention-close');
                    notify.dismiss(id);
                  },
                },
              }),
            );
          }}
        >
          Agent attention
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            keep(notify.custom(UpdateToast, { componentProps: { previewState: updateAvailable } }))
          }
        >
          Update available
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            keep(
              notify.custom(UpdateToast, { componentProps: { previewState: updateDownloading } }),
            )
          }
        >
          Update downloading
        </Button>
        <Button size="sm" variant="outline" onClick={() => startUndo()}>
          Undoable
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            keep(notify.success('Live stack: first'));
            keep(notify.info('Live stack: second'));
          }}
        >
          Stack
        </Button>
        <Button size="sm" variant="ghost" onClick={() => notify.dismiss()}>
          Clear live toasts
        </Button>
      </div>
      {policyControls && (
        <div className="flex flex-wrap gap-2" aria-label="Notification policy controls">
          <Button
            disabled={progressId === null}
            onClick={() => progress.current?.update('Progress updated', callbacks)}
          >
            Update progress
          </Button>
          <Button
            disabled={progressId === null}
            onClick={() => progress.current?.success('Progress complete', callbacks)}
          >
            Complete progress
          </Button>
          <Button
            disabled={progressId === null}
            onClick={() =>
              progress.current?.error(
                { message: 'Progress failed', details: 'Progress diagnostic' },
                callbacks,
              )
            }
          >
            Fail progress
          </Button>
          <Button
            disabled={progressId === null}
            onClick={() => progress.current && notify.dismiss(progress.current)}
          >
            Dismiss progress
          </Button>
          <Button
            onClick={() => {
              const id = keep(
                notify.info('Keyed first message', { key: 'catalog-keyed', duration: Infinity }),
              );
              setKeyedIds([id]);
            }}
          >
            Start keyed notification
          </Button>
          <Button
            onClick={() => {
              const id = keep(
                notify.success('Keyed replacement message', {
                  key: 'catalog-keyed',
                  duration: Infinity,
                }),
              );
              setKeyedIds((previous) => [...previous, id]);
            }}
          >
            Replace keyed notification
          </Button>
          <Button onClick={() => startUndo(true)}>Failing undo</Button>
          <Button
            disabled={undoId === null}
            onClick={() => undoId !== null && notify.dismiss(undoId)}
          >
            Dismiss undo notification
          </Button>
        </div>
      )}
      <output className="sr-only" data-testid="notify-progress-id">
        {progressId}
      </output>
      <output className="sr-only" data-testid="notify-keyed-ids">
        {JSON.stringify(keyedIds)}
      </output>
      <output className="sr-only" data-testid="notify-events">
        {events.join(',')}
      </output>
    </section>
  );
}
