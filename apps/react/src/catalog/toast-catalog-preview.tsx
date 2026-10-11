// Source: src/lib/component-catalog/renderers/ToastCatalogPreview.svelte.
// i18n-ignore (source catalog fixture content)
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  Toast,
  AgentAttentionToast,
  AgentFailureToast,
  ErrorToast,
  UpdateToast,
  ToastUndoAction,
  TOAST_COUNTDOWN_CLASS,
  toast,
  type ExternalToast,
} from '@/components/ui/toast';
import { NotifyErrorToast } from '@/components/patterns/notify/notify-error-toast';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { NotifyExample } from './notify-catalog-preview';
import './toast-catalog-preview.css';

const previewRegions = [
  ['success', 'Sonner success'],
  ['error', 'Sonner error'],
  ['warning', 'Sonner warning'],
  ['info', 'Sonner info'],
  ['loading', 'Sonner loading'],
  ['notify-error', 'Notify error with details'],
  ['app-error', 'Application error'],
  ['agent-failure', 'Agent failure'],
  ['agent-attention', 'Agent attention'],
  ['update-available', 'Update available'],
  ['update-downloading', 'Update downloading'],
  ['undoable', 'Undoable, countdown paused'],
  ['stack', 'Multi-toast stack'],
] as const;
const noOp = () => undefined;
export function ToastCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const scope = useId();
  const [stackCount, setStackCount] = useState(3);
  const stackIds = useRef<Array<string | number>>([]);
  const toasterId = (region: string) => `toast-catalog-${scope}-${region}`;
  useEffect(() => {
    const options = (region: string, extra: ExternalToast = {}): ExternalToast => ({
      id: `toast-catalog-${scope}-${region}`,
      toasterId: toasterId(region),
      duration: Infinity,
      ...extra,
    });
    const updateInfo = {
      version: '4.2.0',
      releaseDate: '2026-09-07',
      releaseNotes: 'Catalog preview',
    };
    const ids = [
      toast.success('Workspace saved', options('success')),
      toast.error('Could not save workspace', options('error')),
      toast.warning('Connection is unstable', options('warning')),
      toast.info('A newer workspace snapshot is available', options('info')),
      toast.loading(
        'Synchronizing workspace',
        options('loading', { description: '· 12 of 40 files' }),
      ),
      toast.custom(
        (id) => (
          <NotifyErrorToast
            message="Request failed"
            details={'JSON-RPC -32000\nThe daemon rejected the request.'}
            closeToast={() => toast.dismiss(id)}
          />
        ),
        options('notify-error'),
      ),
      toast.custom(
        (id) => (
          <ErrorToast
            error={{
              id: 'catalog-error',
              type: 'error',
              title: 'The workspace could not be opened',
              message: 'The local index is corrupted or locked by another process.',
              timestamp: new Date('2026-09-07T00:00:00Z'),
              recoverable: true,
            }}
            onCopy={noOp}
            onDebug={noOp}
            onRetry={noOp}
            closeToast={() => toast.dismiss(id)}
          />
        ),
        options('app-error'),
      ),
      toast.custom(
        () => (
          <AgentFailureToast
            title="Implementor failed"
            errorSummary="The agent process exited before completing its task."
            contextLine="Implementor — Toast catalog"
            retryLabel="Retry Implementor"
            retrying={false}
            onRetry={noOp}
            onSwitchTo={noOp}
            onClose={noOp}
          />
        ),
        options('agent-failure'),
      ),
      toast.custom(
        () => (
          <AgentAttentionToast
            title="Coordinator requests a discussion"
            timestamp={new Date(Date.now() - 18000).toISOString()}
            reason="Choose whether the catalog should include diagnostic details."
            kind="discussion"
            onSwitchTo={noOp}
            onClose={noOp}
          />
        ),
        options('agent-attention'),
      ),
      toast.custom(
        (id) => (
          <UpdateToast
            closeToast={() => toast.dismiss(id)}
            previewState={{
              status: 'available',
              updateInfo,
              availableDescription: 'Ready to install · 84 MB',
            }}
          />
        ),
        options('update-available'),
      ),
      toast.custom(
        (id) => (
          <UpdateToast
            closeToast={() => toast.dismiss(id)}
            previewState={{
              status: 'downloading',
              updateInfo,
              progress: {
                percent: 62,
                bytesPerSecond: 2400000,
                transferred: 62000000,
                total: 95600000,
              },
              remainingSeconds: 14,
            }}
          />
        ),
        options('update-downloading'),
      ),
      toast.warning(
        'Workspace archived',
        options('undoable', {
          className: TOAST_COUNTDOWN_CLASS,
          style: {
            '--toast-countdown-duration': '10000ms',
            animationPlayState: 'paused',
          } as CSSProperties,
          action: <ToastUndoAction />,
        }),
      ),
    ];
    stackIds.current = [
      toast.success(
        'First completed task',
        options('stack', { id: `toast-catalog-stack-first-${scope}` }),
      ),
      toast.warning(
        'Archived task restored',
        options('stack', { id: `toast-catalog-stack-second-${scope}` }),
      ),
      toast.info(
        'Second task is ready',
        options('stack', { id: `toast-catalog-stack-front-${scope}` }),
      ),
    ];
    ids.push(...stackIds.current);
    return () => ids.forEach((id) => toast.dismiss(id));
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="grid min-w-0 gap-6"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      <div className="toast-preview-grid">
        {previewRegions.map(([region, label]) => (
          <section
            key={region}
            className="grid min-w-0 content-start gap-2"
            data-toast-preview={region}
          >
            <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
            <Toast
              regionId={`toast-catalog-region-${scope}-${region}`}
              toasterId={toasterId(region)}
              containerAriaLabel={`${label} preview`}
              staticPosition
              staticToastCount={region === 'stack' ? stackCount : undefined}
              onClearAll={
                region === 'stack'
                  ? () => {
                      stackIds.current.forEach((id) => toast.dismiss(id));
                      setStackCount(0);
                    }
                  : undefined
              }
            />
          </section>
        ))}
      </div>
      <div className="border-t border-border pt-4">
        <NotifyExample policyControls={false} />
      </div>
    </div>
  );
}
