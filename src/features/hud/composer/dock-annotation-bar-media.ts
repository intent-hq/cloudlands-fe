/**
 * The annotate tool bar's Screenshot and Record buttons mirror the composer's: this
 * projects the composer's own button state (the same expressions as
 * `DockComposerMediaFooter`) into the compact, localized form the overlay shows.
 */
import { formatNumber } from '$lib/i18n/format';
import type { DockAnnotationMediaState } from '$shared/dock-annotation';
import type {
  DockComposerMediaLabels,
  DockComposerMediaState,
} from '$features/hud/components/dock-composer-media-presentation';

/** m:ss with the canonical locale-aware number formatter (the composer's timer). */
export function formatDockElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = formatNumber(Math.floor(seconds / 60), { useGrouping: false });
  const rest = formatNumber(seconds % 60, { minimumIntegerDigits: 2, useGrouping: false });
  return `${minutes}:${rest}`;
}

export function dockAnnotationBarMedia(
  state: DockComposerMediaState,
  labels: Pick<DockComposerMediaLabels, 'capture' | 'captureLimit' | 'record' | 'stopRecording'>,
  /** Epoch ms the live recording started, if one is live. */
  recordingStartedAt: number | null,
  disabled = false,
): DockAnnotationMediaState {
  const alerts = state.alerts ?? {};
  const captureDisabled = disabled || !!state.captureDisabled;
  return {
    capture: {
      label: labels.capture,
      tooltip:
        alerts.capture ??
        state.captureTooltip ??
        (state.captureDisabled ? labels.captureLimit : labels.capture),
      disabled: captureDisabled,
      pending: !!state.capturePending,
      alert: !!alerts.capture,
    },
    record: {
      label: state.recording ? labels.stopRecording : labels.record,
      tooltip:
        alerts.record ??
        state.recordingTooltip ??
        (state.recording ? labels.stopRecording : labels.record),
      disabled: disabled || !!state.recordingDisabled,
      pending: !!state.recordingPending,
      alert: !!alerts.record,
      recording: state.recording,
      startedAt: state.recording ? recordingStartedAt : null,
    },
  };
}
