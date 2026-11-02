import type { Snippet } from 'svelte';

/** Display-only contract. The session owner retains bytes, revisions and transport state. */
export type DockComposerTool = 'pick' | 'box' | 'pen' | 'arrow';

export interface DockComposerMediaLabels {
  capture: string;
  captureLimit: string;
  /** Record is disabled once the message holds the most recordings it can carry. */
  clipLimit: string;
  record: string;
  stopRecording: string;
  annotate: string;
  annotationTools: string;
  annotateCurrent: (tool: string) => string;
  tools: Record<DockComposerTool, string>;
  dictate: string;
  stopDictating: string;
  annotating: string;
  listening: string;
  recording: string;
  markUp: string;
  remove: string;
  play: string;
  done: string;
  attachments: string;
  retry: string;
  attachmentPending: string;
  attachmentFailed: string;
  speechError?: (code: string) => string;
  image: (marks: number) => string;
  clip: (duration: string) => string;
  /** Text chip where recording `n` started (`end` false) or stopped while dictating. */
  recordingReference: (n: number, end: boolean) => string;
}

/** Controls a missing OS permission can block. */
export type DockComposerAlertTarget = 'capture' | 'record' | 'annotate' | 'pick' | 'mic';

export interface DockComposerMediaState {
  /** Changes only after a successful capture, to acknowledge that operation once. */
  captureRevision: number;
  capturePending?: boolean;
  captureDisabled?: boolean;
  captureTooltip?: string;
  annotationActive: boolean;
  tool: DockComposerTool;
  toolUsed: boolean;
  annotationDisabled?: boolean;
  recording: boolean;
  recordingPending?: boolean;
  recordingDisabled?: boolean;
  recordingTooltip?: string;
  /** Formatted by the controller using the application's locale-aware formatter. */
  recordingTime: string;
  dictating: boolean;
  dictationPending?: boolean;
  dictationDisabled?: boolean;
  dictationTooltip?: string;
  dictationTime: string;
  /** Oldest to newest normalized microphone samples. Never synthesized by the UI. */
  inputLevels: readonly number[];
  /**
   * A missing permission blocks the control: it keeps its glyph, shows an alert
   * dot, its tooltip is this permission line, and a click calls `onAlert` (which
   * opens the right System Settings pane) instead of starting.
   */
  alerts?: Partial<Record<DockComposerAlertTarget, string>>;
}

interface DockComposerMediaActions {
  onCapture: () => void;
  onRecordToggle: () => void;
  onAnnotationToggle: () => void;
  onToolSelect: (tool: DockComposerTool) => void;
  onDictationToggle: () => void;
  /** The owner handles stop-before-start races and shares the canonical mic session. */
  onDictationHoldStart: () => void;
  onDictationHoldEnd: () => void;
  /** A blocked control was clicked: open its System Settings pane (user click only). */
  onAlert?: (target: DockComposerAlertTarget) => void;
}

export interface DockComposerMediaFooterProps extends DockComposerMediaActions {
  state: DockComposerMediaState;
  labels: DockComposerMediaLabels;
  disabled?: boolean;
  annotationNotice?: string;
  model?: Snippet;
  /** Canonical send/stop/queue control; this surface never implements admission. */
  send?: Snippet;
}

export type DockComposerAttachment = (
  | {
      kind: 'image';
      id: string;
      /** Already composited image, including authoritative marks and number badges. */
      url: string;
      markCount: number;
      /**
       * A pasted or dropped image: an ordinary attachment, not a screenshot. It
       * renders with the shared preview (file name, lightbox), takes no marks
       * and does not count toward the screenshot limit.
       */
      file?: { name: string; imageData: string; imageMimeType: string };
    }
  | { kind: 'clip'; id: string; url?: string; duration: string; recording: boolean }
  | { kind: 'file'; id: string; name: string }
) & {
  /** Evidence uses the HUD controller; ordinary attachments use the shared editor's placement API. */
  owner: 'evidence' | 'attachment';
  status?: 'placing' | 'failed';
  error?: string;
};

export interface DockComposerAttachmentsProps {
  items: readonly DockComposerAttachment[];
  labels: DockComposerMediaLabels;
  disabled?: boolean;
  onMarkUp: (id: string) => void;
  /** Removal and renumbering are one operation owned by the draft controller. */
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}

/** One controlled view from the connected dock/evidence owner. */
export interface DockComposerMediaBinding extends DockComposerMediaActions {
  state: DockComposerMediaState;
  labels: DockComposerMediaLabels;
  attachments: readonly DockComposerAttachment[];
  placeholder?: string;
  annotationNotice?: string;
  /** Stop/await narration and drain editor insertions. False keeps the draft intact. */
  beforeSubmit?: () => Promise<boolean>;
  onMarkUp: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}
