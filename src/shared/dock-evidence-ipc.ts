import { IPC_CHANNELS } from './ipc-registry';
import type {
  DockCapturedPixels,
  DockEvidenceImage,
  DockNativeResult,
  DockEvidenceNativeService,
  DockEvidenceNativeEvent,
} from './dock-evidence';
import type { DockSpeechEvent } from './dock-speech';

export const DOCK_EVIDENCE_CHANNELS = IPC_CHANNELS.DOCK_EVIDENCE;

/** A draft lifetime, not merely the workspace/agent pair's persistent key. */
export interface DockEvidenceBeginRequest {
  workspaceId: string;
  agentId: string;
  draftId: string;
}

export interface DockEvidenceSession extends DockEvidenceBeginRequest {
  sessionId: string;
}

export interface DockEvidenceCaptureRequest extends DockEvidenceSession {
  requestId: string;
  source?: DockEvidenceImage['source'];
}

interface DockEvidenceCaptureResult extends DockEvidenceSession {
  requestId: string;
  image: DockEvidenceImage;
  pixels: DockCapturedPixels;
}

export type DockEvidenceBeginResult = DockNativeResult<DockEvidenceSession>;
export type DockEvidencePixelsResult = DockNativeResult<DockEvidenceCaptureResult>;
export type DockEvidencePrivacyPane = 'screen' | 'microphone' | 'speech' | 'accessibility';

export type DockEvidenceControl =
  | { action: 'capabilities' }
  /** Probe only (never prompts): `{ trusted }` for element picking. */
  | { action: 'accessibility-status' }
  | { action: 'open-settings'; pane: DockEvidencePrivacyPane }
  | {
      action: 'annotation-start';
      annotation: Parameters<DockEvidenceNativeService['startAnnotation']>[0];
    }
  | {
      action: 'annotation-tool';
      annotationId: string;
      tool: Parameters<DockEvidenceNativeService['setAnnotationTool']>[1];
    }
  | { action: 'annotation-mouse'; annotationId: string }
  | {
      action: 'annotation-media';
      media: Parameters<NonNullable<DockEvidenceNativeService['setAnnotationMedia']>>[0];
    }
  | {
      action: 'annotation-sync';
      annotationId: string;
      marks: Parameters<DockEvidenceNativeService['syncMarks']>[1];
    }
  | { action: 'annotation-end'; annotationId: string }
  | { action: 'annotation-mark-result'; annotationId: string; markId: string; accepted: boolean }
  | { action: 'clip-start'; clipId: string; maxMs: number }
  | { action: 'clip-stop'; clipId: string }
  | { action: 'clip-release'; clipId: string }
  | { action: 'speech-start'; speechId: string; locale?: string }
  | { action: 'speech-stop'; speechId: string }
  | { action: 'speech-mark'; speechId: string; markId: string };

export type DockEvidenceEvent = DockEvidenceSession &
  (
    | { kind: 'evidence'; event: DockEvidenceNativeEvent }
    | { kind: 'speech'; speechId: string; event: DockSpeechEvent }
  );
