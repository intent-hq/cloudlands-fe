// Source: src/lib/components/ui/toast/toast-overflow.preview.svelte (all 19 computed states).
// i18n-ignore (source preview fixture content)
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Toast,
  ErrorToast,
  AgentAttentionToast,
  AgentFailureToast,
  UpdateToast,
  toast,
  type UpdateToastPreviewState,
} from '@/components/ui/toast';
import { notify } from '@/components/patterns/notify';
export const toastOverflowStates = [
  'standard',
  'deleted',
  'url-unicode',
  'empty',
  'actions',
  'details',
  'application-error',
  'discussion',
  'blocker',
  'failure',
  'auth',
  'retrying',
  'update-available',
  'update-downloading',
  'update-downloaded',
  'update-error',
  'mixed',
  'burst',
  'keyboard-stack',
] as const;
const longText = Array.from(
  { length: 18 },
  (_, i) =>
    `Paragraph ${i + 1}: this deleted chat message contains a full explanation that must stay inside the notification.`,
).join('\n');
const difficultText = `https://example.test/${'long-path'.repeat(40)}\n${'超長い通知'.repeat(50)} 🧑🏽‍💻 مرحبا بالعالم\n${longText}`;
const diagnostics = Array.from(
  { length: 40 },
  (_, i) => `Diagnostic ${i + 1}: ${difficultText}`,
).join('\n');
export function ToastOverflowPreview({
  scenario,
}: {
  scenario: (typeof toastOverflowStates)[number];
}) {
  const scope = useId();
  const toasterId = `toast-overflow-preview-${scope}`;
  const ids = useRef(new Set<string>());
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents((previous) => [...previous, event]);
  function show(kind: string = scenario, id = `overflow-${scope}-${kind}`) {
    ids.current.add(id);
    const common = { id, toasterId, duration: Infinity };
    const close = () => {
      record('close');
      toast.dismiss(id);
    };
    if (kind === 'mixed' || kind === 'burst' || kind === 'keyboard-stack') {
      const kinds =
        kind === 'keyboard-stack'
          ? ['short-action', 'update-downloaded', 'deleted']
          : kind === 'mixed'
            ? ['discussion', 'details', 'auth', 'standard', 'update-downloaded', 'deleted']
            : Array.from({ length: 12 }, (_, i) => (i % 2 ? 'standard' : 'deleted'));
      kinds.forEach((type, i) => show(type, `overflow-stack-${scope}-${i}`));
    } else if (kind === 'details')
      notify.error({ message: longText, details: diagnostics }, common);
    else if (kind === 'application-error')
      toast.custom(
        (toastId) => (
          <ErrorToast
            error={{
              id,
              type: 'error',
              title: longText,
              message: difficultText,
              recoverable: true,
              timestamp: new Date('2026-10-06T12:00:00Z'),
            }}
            onCopy={() => record('copy')}
            onDebug={() => record('debug')}
            onRetry={() => record('retry')}
            closeToast={() => toast.dismiss(toastId)}
          />
        ),
        common,
      );
    else if (kind === 'discussion' || kind === 'blocker')
      toast.custom(
        () => (
          <AgentAttentionToast
            title={longText}
            reason={difficultText}
            kind={kind}
            keySlot={2}
            timestamp="2026-10-06T12:00:00Z"
            onSwitchTo={() => record('switch')}
            onClose={close}
          />
        ),
        common,
      );
    else if (['failure', 'auth', 'retrying'].includes(kind))
      toast.custom(
        () => (
          <AgentFailureToast
            title={longText}
            errorSummary={difficultText}
            contextLine={difficultText}
            keySlot={2}
            retryLabel="Retry the agent with a very long display name"
            retrying={kind === 'retrying'}
            retryNote={difficultText}
            loginCommandHint={
              kind === 'auth' ? `claude auth login --fixture=${'x'.repeat(220)}` : undefined
            }
            showClaudeDesktopNote={kind === 'auth'}
            onRetry={() => record('retry')}
            onSwitchTo={() => record('switch')}
            onClose={close}
          />
        ),
        common,
      );
    else if (kind.startsWith('update-')) {
      const previewState: UpdateToastPreviewState = {
        status: kind.slice(7) as UpdateToastPreviewState['status'],
        updateInfo: {
          version: '4.2.0-alpha.20261006',
          releaseDate: '2026-10-06',
          releaseNotes: longText,
        },
        availableDescription: difficultText,
        error: difficultText,
        progress: { percent: 62, bytesPerSecond: 2400000, transferred: 62000000, total: 100000000 },
        remainingSeconds: 14,
        onInstall: () => record('install'),
        onDownload: () => record('download'),
      };
      toast.custom(
        () => (
          <UpdateToast
            previewState={previewState}
            onDismiss={close}
            onAutoDismiss={() => undefined}
          />
        ),
        common,
      );
    } else if (kind === 'short-action')
      toast.success('Changes saved', {
        ...common,
        action: { label: 'Review', onClick: () => record('review') },
      });
    else if (kind === 'deleted')
      toast.warning(`Deleted message: ${longText}`, {
        ...common,
        action: { label: 'Undo', onClick: () => record('undo') },
      });
    else
      toast(kind === 'empty' ? '' : kind === 'url-unicode' ? difficultText : longText, {
        ...common,
        description: kind === 'empty' ? undefined : difficultText,
        ...(kind === 'actions'
          ? {
              action: {
                label: 'Review all changes in the workspace before continuing',
                onClick: () => record('action'),
              },
              cancel: {
                label: 'Keep working and remind me about these changes later',
                onClick: () => record('cancel'),
              },
            }
          : {}),
      });
  }
  useEffect(() => {
    const ownedIds = ids.current;
    show();
    return () => ownedIds.forEach((id) => toast.dismiss(id));
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="min-h-64 p-4" data-testid="toast-overflow-preview" data-scenario={scenario}>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => show()}>Show fixture again</Button>
        <Button onClick={() => show('mixed')}>Add mixed stack</Button>
        <Button onClick={() => show('burst')}>Add burst</Button>
      </div>
      <output className="sr-only" data-testid="toast-overflow-events">
        {events.join(',')}
      </output>
      <Toast toasterId={toasterId} regionId={`toast-overflow-region-${scope}`} />
    </div>
  );
}
