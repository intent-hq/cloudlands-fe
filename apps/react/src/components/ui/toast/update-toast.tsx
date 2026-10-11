import { Fragment, useEffect, useMemo, useRef } from 'react';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { crispOut, springIn, usePresence, usePresenceTransition } from '@/lib/motion';
import { useAutoUpdateToastState } from '@/store/auto-update/auto-update-toast';
import { createFormatters } from '$shared/i18n/formatters';
import { getLocale } from '$shared/paraglide/runtime.js';
import { m } from '$shared/paraglide/messages.js';
import type {
  UpdateInfo,
  UpdateProgress,
  UpdateStatus,
} from '../../../../../../src/features/auto-update/types';
import { ToastCloseButton } from './toast-close-button';
import { ToastGlyph } from './toast-glyph';
import './update-toast.css';

const { formatNumber, formatInteger } = createFormatters(getLocale);

export interface UpdateToastPreviewState {
  status: UpdateStatus;
  updateInfo?: UpdateInfo | null;
  progress?: UpdateProgress | null;
  currentVersion?: string;
  error?: string | null;
  availableDescription?: string;
  remainingSeconds?: number;
  onInstall?: () => void;
  onDownload?: () => void;
}

export interface UpdateToastProps {
  onDismiss?: () => void;
  onAutoDismiss?: () => void;
  closeToast?: () => void;
  previewState?: UpdateToastPreviewState;
}

const celebrateTransition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in'
      ? springIn(node, { tier: 'slow', y: 30, scale: 1 })
      : crispOut(node, { tier: 'slow' });

function CelebrateGlyph({ present, onExit }: { present: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, celebrateTransition);
  return (
    <div ref={ref} className="flex shrink-0">
      <ToastGlyph variant="celebrate" />
    </div>
  );
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024)
    return m.ui_updateToast_speedMbps_label({
      speed: formatNumber(bytesPerSecond / (1024 * 1024), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    });
  if (bytesPerSecond >= 1024)
    return m.ui_updateToast_speedKbps_label({ speed: formatInteger(bytesPerSecond / 1024) });
  return m.ui_updateToast_speedBps_label({ speed: formatInteger(bytesPerSecond) });
}

export function UpdateToast({ previewState, ...props }: UpdateToastProps) {
  return previewState ? (
    <UpdateToastView {...props} state={previewState} />
  ) : (
    <LiveUpdateToast {...props} />
  );
}

function LiveUpdateToast(props: Omit<UpdateToastProps, 'previewState'>) {
  const state = useAutoUpdateToastState();
  return <UpdateToastView {...props} state={state} />;
}

function UpdateToastView({
  state,
  onDismiss,
  onAutoDismiss,
  closeToast,
}: Omit<UpdateToastProps, 'previewState'> & { state: UpdateToastPreviewState }) {
  const { status, updateInfo, progress, currentVersion, error, onDownload } = state;
  const downloaded = useMemo(() => (status === 'downloaded' ? [state] : []), [status, state]);
  const { entries: downloadedEntries, remove } = usePresence(downloaded, () => 'downloaded');
  const progressPercent = progress ? Math.round(progress.percent) : 0;
  const remainingSeconds =
    state.remainingSeconds ??
    (progress && progress.bytesPerSecond > 0
      ? Math.max(0, Math.ceil((progress.total - progress.transferred) / progress.bytesPerSecond))
      : null);
  function handleClose() {
    onDismiss?.();
    closeToast?.();
  }
  useEffect(() => {
    const autoDismiss = onAutoDismiss ?? onDismiss;
    if ((status !== 'not-available' && status !== 'error') || !autoDismiss) return;
    const timer = setTimeout(autoDismiss, status === 'error' ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [status, onAutoDismiss, onDismiss]);
  return (
    <div className="update-toast">
      {status === 'checking' && (
        <div className="toast-row">
          <ToastGlyph variant="loading" />
          <div className="title" data-toast-title>
            {m.ui_updateToast_checking_label()}
          </div>
        </div>
      )}
      {status === 'available' && (
        <>
          <div className="toast-row">
            <ToastGlyph variant="update" />
            <div className="title" data-toast-title>
              {m.ui_updateToast_available_label({ version: updateInfo?.version || '' })}
            </div>
            <Button
              variant="primary"
              size="compact"
              className="toast-action ml-auto"
              onClick={onDownload}
            >
              {m.ui_updateToast_download_label()}
            </Button>
          </div>
          <div className="description" data-toast-description>
            {state.availableDescription ?? m.ui_updateToast_readyToDownload_description()}
          </div>
        </>
      )}
      {status === 'downloading' && (
        <div className="toast-downloading">
          <div className="toast-row">
            <ToastGlyph variant="update" />
            <div className="title" data-toast-title>
              {m.ui_updateToast_downloading_label({ version: updateInfo?.version || '' })}
            </div>
            <span className="toast-progress-label">{formatInteger(progressPercent)}%</span>
            <ToastCloseButton
              inline
              onClick={handleClose}
              ariaLabel={m.ui_updateToast_close_ariaLabel()}
            />
          </div>
          <div className="description" data-toast-description>
            {progress && formatSpeed(progress.bytesPerSecond)}
            {remainingSeconds != null && (
              <>
                {' '}
                ·{' '}
                {m.ui_updateToast_remainingSeconds_label({
                  seconds: formatInteger(remainingSeconds),
                })}
              </>
            )}
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
      {downloadedEntries.map(({ key, value, present }) => (
        <Fragment key={key}>
          <div className="toast-row" inert={!present}>
            <CelebrateGlyph present={present} onExit={() => remove(key)} />
            <div className="title" data-toast-title>
              {m.ui_updateToast_updateReady_label()}
            </div>
            <Button
              variant="primary"
              size="compact"
              className="toast-action"
              onClick={value.onInstall}
            >
              <ArrowsClockwiseIcon size={16} weight="regular" aria-hidden="true" />
              {m.ui_updateToast_install_label()}
            </Button>
            <ToastCloseButton
              inline
              onClick={handleClose}
              ariaLabel={m.ui_updateToast_close_ariaLabel()}
            />
          </div>
          <div className="description" data-toast-description>
            {m.ui_updateToast_readyToInstall_description({
              version: value.updateInfo?.version ?? '',
            })}
          </div>
        </Fragment>
      ))}
      {status === 'not-available' && (
        <>
          <div className="toast-row">
            <ToastGlyph variant="celebrate" />
            <div className="title" data-toast-title>
              {m.ui_updateToast_upToDate_label()}
            </div>
          </div>
          <div className="description" data-toast-description>
            {m.ui_updateToast_runningVersion_description({ version: currentVersion ?? '' })}
          </div>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="toast-row">
            <ToastGlyph variant="error" />
            <div className="title" data-toast-title>
              {m.ui_updateToast_checkFailed_label()}
            </div>
            <ToastCloseButton
              inline
              onClick={handleClose}
              ariaLabel={m.ui_updateToast_close_ariaLabel()}
            />
          </div>
          <div className="description" data-toast-description>
            {error || m.ui_updateToast_unknown_error()}
          </div>
        </>
      )}
    </div>
  );
}
