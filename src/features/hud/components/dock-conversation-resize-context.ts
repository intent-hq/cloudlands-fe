import { getContext, setContext } from 'svelte';
import type { DockPointerRect } from '$shared/dock-layout';

export type DockResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export interface DockConversationSize {
  width: number;
  height: number;
}

export interface DockConversationResizeContext {
  readonly enabled: boolean;
  readonly size: DockConversationSize;
  readonly minimum: DockConversationSize;
  readonly maximum: DockConversationSize;
  readonly edges: DockResizeEdge[];
  readonly screenRect: DockPointerRect;
  readonly held: boolean;
  resize: (size: DockConversationSize) => void;
  sizeAtPointer: (edge: DockResizeEdge, screen: { x: number; y: number }) => DockConversationSize;
  begin: (screen: { x: number; y: number }) => boolean;
  end: (cancel: boolean) => void;
}

const CONTEXT = Symbol('dock-conversation-resize');

export function setDockConversationResize(context: DockConversationResizeContext): void {
  setContext(CONTEXT, context);
}

export function getDockConversationResize(): DockConversationResizeContext | undefined {
  return getContext<DockConversationResizeContext | undefined>(CONTEXT);
}
