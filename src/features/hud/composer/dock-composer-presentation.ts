/**
 * Pure, dependency-light projection from dock evidence, composer context and
 * controller-local state into the controlled `DockComposerMediaBinding`.
 * No store, native or lifetime access: the controller owns those.
 */
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { selectDockComposerEvidence } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import type {
  DockComposerAlertTarget,
  DockComposerAttachment,
  DockComposerMediaBinding,
  DockComposerMediaLabels,
} from '$features/hud/components/dock-composer-media-presentation';
import type { DockEvidencePrivacyPane } from '$shared/dock-evidence-ipc';
import type { DockAnnotationIssue } from '$shared/dock-annotation';
import { formatDockElapsed } from './dock-annotation-bar-media';
import { DOCK_EVIDENCE_LIMITS } from '$shared/dock-evidence';
import { m } from '$shared/paraglide/messages.js';
import { intentFileMediaUrlToWorkspaceFile } from '$lib/utils/workspace-file-image';
import type { DockComposerController, DockComposerLocalState } from './dock-composer-controller';

type EvidenceView = ReturnType<typeof selectDockComposerEvidence.select>;

/** Native privacy panes the user may open from a permission-blocked control. */
export type DockSettingsPane = DockEvidencePrivacyPane;

/** Workspace-file playback URL from a daemon placement path (video only). */
export function dockClipPlaybackUrl(
  workspaceId: string,
  path: string | undefined,
): string | undefined {
  // Only daemon-managed attachments are playable; never an arbitrary workspace path.
  if (!path?.startsWith('.intent/attachments/')) return undefined;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const media = intentFileMediaUrlToWorkspaceFile(`intent://local/file/${encoded}`, workspaceId);
  return media?.kind === 'video' ? media.url : undefined;
}

/** Which privacy pane a permission failure points at, if any. */
function settingsPaneFor(
  captureError: string | null,
  clipError: string | null,
  speechError: string | null,
  issue: DockAnnotationIssue | null,
): DockSettingsPane | undefined {
  // Annotate: element picking reads accessibility metadata; checking or capturing the screen needs Screen Recording.
  if (issue?.error === 'permission') return issue.kind === 'pick' ? 'accessibility' : 'screen';
  if (captureError === 'permission' || clipError === 'permission') return 'screen';
  if (speechError?.startsWith('microphone-permission')) return 'microphone';
  if (speechError?.startsWith('speech-permission')) return 'speech';
  return undefined;
}

/** Panel header status: one live capture at a time, recording first. */
export interface DockComposerMediaStatus {
  kind: 'annotating' | 'listening' | 'recording';
  label: string;
}

const elapsed = formatDockElapsed;

/**
 * Pure projection of evidence + composer context + local state into the
 * controlled binding. Evidence ids are stable native/model ids; ordinary
 * attachments keep their canonical ContextItem id.
 */
export function buildDockComposerMedia(input: {
  /** The pair's workspace; playback URLs are scoped to it. */
  workspaceId: string;
  view: EvidenceView;
  items: readonly ContextItem[];
  local: DockComposerLocalState;
  labels: DockComposerMediaLabels;
  actions: DockComposerController['actions'];
  beforeSubmit: () => Promise<boolean>;
  /** Catalog copy the shared label factory does not carry. */
  copy?: {
    idle: string;
    captured: string;
    annotating: string;
    permission: string;
    openSettings: string;
    speechPermission: string;
    accessibilityPermission: string;
    annotationUnavailable: string;
  };
}): DockComposerMediaBinding & {
  mediaStatus?: DockComposerMediaStatus;
  /** Pane the most relevant permission-blocked control opens (user click only). */
  settingsPane?: DockSettingsPane;
  /** Localized hint when annotating could not check or read the screen (no settings pane). */
  annotationNotice?: string;
} {
  const { view, items, local, labels, copy } = input;
  // A live failure wins; before any start, the capability's denied/restricted reason still counts.
  const speechCode = view.speech.error ?? view.speech.capability?.reason ?? null;
  const settingsPane = settingsPaneFor(
    view.captureError,
    view.clips.find((clip) => clip.status === 'failed' && clip.error === 'permission')?.error ??
      null,
    speechCode,
    view.annotationIssue,
  );
  const annotationNotice =
    view.annotationIssue?.error === 'unavailable' ? copy?.annotationUnavailable : undefined;
  // Each blocked control carries its own alert (dot + permission tooltip); a click
  // opens its pane instead of starting. No separate settings button.
  const issue = view.annotationIssue;
  // The alert sits on the tool that was refused: a denied mark marks annotate, a
  // denied capture or recording marks those two (they share the permission).
  const captureBlocked = view.captureError === 'permission';
  const markBlocked = issue?.error === 'permission' && issue.kind !== 'pick';
  const accessibilityBlocked = issue?.error === 'permission' && issue.kind === 'pick';
  const micPane: DockSettingsPane | undefined = speechCode?.startsWith('speech-permission')
    ? 'speech'
    : speechCode?.startsWith('microphone-permission') || speechCode === 'permission'
      ? 'microphone'
      : undefined;
  const alerts: Partial<Record<DockComposerAlertTarget, string>> = {};
  const panes: Partial<Record<DockComposerAlertTarget, DockSettingsPane>> = {};
  const alert = (target: DockComposerAlertTarget, text: string, pane?: DockSettingsPane) => {
    alerts[target] = text;
    if (pane) panes[target] = pane;
  };
  if (copy) {
    if (captureBlocked) {
      alert('capture', copy.permission, 'screen');
      if (!view.recording) alert('record', copy.permission, 'screen');
    }
    if (markBlocked && !view.annotating) alert('annotate', copy.permission, 'screen');
    if (accessibilityBlocked) {
      alert('pick', copy.accessibilityPermission, 'accessibility');
      // Only while pick is the tool a click would start; a live session still ends.
      if (view.tool === 'pick' && !view.annotating)
        alert('annotate', copy.accessibilityPermission, 'accessibility');
    }
    if (micPane && !view.dictation)
      alert(
        'mic',
        (speechCode && labels.speechError?.(speechCode)) ?? copy.speechPermission,
        micPane,
      );
  }
  const onAlert = (target: DockComposerAlertTarget) => {
    const pane = panes[target];
    if (pane) input.actions.onOpenSettings(pane);
  };
  const owned = new Set(view.evidenceOwnedItemIds);
  const recordingClip = view.clips.find((clip) => clip.status === 'recording');
  const clipsFull = view.clips.length >= DOCK_EVIDENCE_LIMITS.clips;
  const caps = view.capabilities;
  const speechAvailable = view.speech.available;
  const attachments: DockComposerAttachment[] = [
    ...view.tiles.map(({ image, marks }): DockComposerAttachment => ({
      kind: 'image',
      id: image.contextItemId,
      url: local.previews[image.id] ?? '',
      markCount: marks.length,
      owner: 'evidence',
      // No preview yet: explicit pending so presentation never renders an empty image.
      ...(local.previews[image.id] ? {} : { status: 'placing' as const }),
    })),
    // One tile per recording, in start order.
    ...view.clips.map((clip): DockComposerAttachment => ({
      kind: 'clip' as const,
      // The context item exists once native returns the file; a live recording has only its id.
      id: clip.contextItemId ?? clip.id,
      duration: elapsed(clip.status === 'recording' ? local.now - clip.startedAt : clip.durationMs),
      recording: clip.status === 'recording',
      ...(clip.status === 'ready' && dockClipPlaybackUrl(input.workspaceId, clip.path)
        ? { url: dockClipPlaybackUrl(input.workspaceId, clip.path) }
        : {}),
      owner: 'evidence' as const,
      ...(clip.status === 'placing' ? { status: 'placing' as const } : {}),
      ...(clip.status === 'failed'
        ? {
            status: 'failed' as const,
            // Codes are not copy: only a too-large clip has its own message;
            // others use the tile's generic failure label.
            ...(clip.error === 'limit' ? { error: m.dock_composer_clipTooLarge_error() } : {}),
          }
        : {}),
    })),
    ...items
      .filter((item) => !owned.has(item.id))
      .map((item): DockComposerAttachment => ({
        ...(item.imageData && item.imageMimeType
          ? {
              kind: 'image' as const,
              id: item.id,
              url: `data:${item.imageMimeType};base64,${item.imageData}`,
              markCount: 0,
              file: {
                name: item.label,
                imageData: item.imageData,
                imageMimeType: item.imageMimeType,
              },
            }
          : { kind: 'file' as const, id: item.id, name: item.label }),
        owner: 'attachment',
        ...(item.placementStatus === 'placing' ? { status: 'placing' as const } : {}),
        ...(item.placementStatus === 'failed'
          ? { status: 'failed' as const, error: item.placementError }
          : {}),
      })),
  ];
  const mediaStatus: DockComposerMediaStatus | undefined = view.recording
    ? { kind: 'recording', label: labels.recording }
    : view.dictation
      ? { kind: 'listening', label: labels.listening }
      : view.annotating
        ? { kind: 'annotating', label: labels.annotating }
        : undefined;
  return {
    mediaStatus,
    ...(settingsPane ? { settingsPane } : {}),
    ...(annotationNotice ? { annotationNotice } : {}),
    labels,
    attachments,
    ...(copy
      ? {
          // Live dictation is content: no hint under the words about to appear.
          placeholder: view.dictation
            ? ''
            : view.annotating
              ? copy.annotating
              : view.tiles.length
                ? copy.captured
                : copy.idle,
        }
      : {}),
    state: {
      captureRevision: view.captureAccepted,
      capturePending: view.capturePending,
      captureDisabled: !caps.capture || view.captureDisabled,
      ...(view.captureDisabled ? { captureTooltip: labels.captureLimit } : {}),
      annotationActive: view.annotating,
      tool: view.tool,
      toolUsed: view.toolUsed,
      annotationDisabled: !caps.annotate,
      recording: view.recording,
      // A finished clip uploads in the background; a new recording can start meanwhile.
      recordingDisabled: !view.recording && (!caps.record || clipsFull),
      ...(clipsFull && !view.recording ? { recordingTooltip: labels.clipLimit } : {}),
      recordingTime: recordingClip ? elapsed(local.now - recordingClip.startedAt) : elapsed(0),
      dictating: !!view.dictation,
      dictationPending: view.speech.pending || view.dictation?.status === 'transcribing',
      // A permission-blocked mic stays clickable: its click opens the pane.
      dictationDisabled: !speechAvailable && !view.dictation && !alerts.mic,
      ...(view.speech.error && labels.speechError
        ? { dictationTooltip: labels.speechError(view.speech.error) }
        : {}),
      dictationTime: view.dictation ? elapsed(local.now - view.dictation.startedAt) : elapsed(0),
      inputLevels: view.speech.levels,
      ...(Object.keys(alerts).length ? { alerts } : {}),
    },
    ...input.actions,
    onAlert,
    beforeSubmit: input.beforeSubmit,
  };
}
