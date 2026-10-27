import type { DockPointerRect } from './dock-layout';

export const ANNOTATION_TOOLS = ['mouse', 'select', 'draw', 'rectangle', 'arrow', 'pin'] as const;

export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];
type AnnotationPhase = 'capturing' | 'review';

export interface AnnotationDestination {
  workspaceId: string;
  workspaceTitle: string;
  /** Null selects the workspace's authoritative main agent at delivery time. */
  agentId: string | null;
}

interface AnnotationDeliveryState {
  status: 'idle' | 'preparing' | 'sending' | 'failed' | 'uncertain' | 'sent';
  requestId?: string;
  error?: string;
}

export interface AnnotationSendRequest {
  requestId: string;
  destination: AnnotationDestination;
}

export interface SetAnnotationDestinationRequest {
  startedAt: number;
  destination: AnnotationDestination;
}

export interface RequestAnnotationSendRequest {
  startedAt: number;
  /** Retry an unchanged failed submission; uncertain delivery always keeps its identity. */
  retryRequestId?: string;
}

export interface ReportAnnotationDeliveryRequest {
  startedAt: number;
  requestId: string;
  status: 'failed' | 'uncertain' | 'sent';
  error?: string;
}

export const ANNOTATION_TOOLBAR_SIZE = { width: 720, height: 72, expandedHeight: 320 } as const;

export interface SetAnnotationToolbarLayoutRequest {
  startedAt: number;
  expanded: boolean;
  /** Visible controls/popover rectangles in window-local DIP, measured after resize. */
  interactiveRects: DockPointerRect[];
}

export interface AnnotationSessionState {
  workspaceId: string;
  workspaceTitle: string;
  tool: AnnotationTool;
  phase: AnnotationPhase;
  screenshotDataUrl: string;
  screenshotRevision: number;
  startedAt: number;
  transcripts: string[];
  destination?: AnnotationDestination;
  sendRequest?: AnnotationSendRequest;
  delivery?: AnnotationDeliveryState;
}

export interface StartAnnotationRequest {
  workspaceId: string;
  workspaceTitle: string;
}

export type AnnotationStartFailureCode =
  'invalid-sender' | 'screen-capture-permission-denied' | 'session-replaced' | 'start-failed';

export type AnnotationStartResult =
  { success: true } | { success: false; error: string; code: AnnotationStartFailureCode };

export interface AnnotationStateResult {
  success: boolean;
  state?: AnnotationSessionState;
  error?: string;
}
