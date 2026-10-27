import type { AnnotationAction, AnnotationPalette } from './utils/annotation-actions';

export const MAX_ANNOTATION_CAPTURES = 6;
export const NEW_ASSISTANT_RECIPIENT = 'new-assistant';

export interface AnnotationWorkspace {
  id: string;
  title: string;
}

export interface AnnotationRecipient {
  id: string;
  agentId: string | null;
  workspaceId: string;
  name: string;
  kind: 'assistant' | 'workspace';
  isDefault?: boolean;
}

export interface AnnotationFrame {
  id: string;
  screenshotDataUrl: string;
  actions: AnnotationAction[];
  palette: AnnotationPalette;
  width: number;
  height: number;
  elapsedMs: number;
}

export interface AnnotationEvidence {
  id: string;
  imageDataUrl: string;
  elapsedMs: number;
  pins: { number: number; elapsedMs: number }[];
}

export interface AnnotationSubmission {
  messageId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceTitle: string;
  recipient: AnnotationRecipient;
  message: string;
  frames: AnnotationEvidence[];
}

export class AnnotationDeliveryError extends Error {
  constructor(
    public readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
  }
}

export function formatAnnotationTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
