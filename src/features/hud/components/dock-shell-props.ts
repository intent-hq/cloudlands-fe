import type { Snippet } from 'svelte';
import type {
  DockEditorCompactIntent,
  DockPlacementSnapshot,
  DockPlacementCommand,
} from '$shared/dock-placement';
import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
import type { DockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
import type { DockRecordingIndicator as RecordingState } from '$features/hud/utils/dock-recording-indicator';
import type { dockPlacementFailureMessage } from '$features/hud/utils/dock-placement-failure';
import type { DockMachineOption } from './dock-machine-types';

export interface DockShellProps {
  workspaces: DockWorkspaceView[];
  olderWorkspaces?: DockWorkspaceView[];
  recording?: RecordingState | null;
  inputLive?: boolean;
  recordingStopping?: boolean;
  onStopRecording?: () => void;
  machines?: DockMachineOption[];
  machineId?: string;
  machineSwitching?: string | null;
  machineError?: boolean;
  onMachine?: (id: string) => void;
  conversation?: Snippet;
  conversationWorkspaceId?: string | null;
  onOpenConversation?: (workspaceId: string) => void;
  onCloseConversation?: () => void;
  onHomeDismiss?: () => void;
  staticData?: boolean;
  placement: DockPlacementSnapshot;
  onPlacementCommand: (command: DockPlacementCommand) => void;
  focusRequest?: number;
  /** Increments when the open shortcut is pressed again: close as Escape would. */
  closeRequest?: number;
  editorCompactRequest?: DockEditorCompactIntent | null;
  /** On a side, the chat the open shortcut returns to (open, last, else first). */
  sideDefaultWorkspaceId?: string | null;
  placementError?: Parameters<typeof dockPlacementFailureMessage>[0];
  dragStartResult?: { id: number; token: string | null } | null;
  resizeStartResult?: { id: number; token: string | null } | null;
  onOpenWorkspace?: (id: string) => void | Promise<void>;
  onOpenAssistant?: () => void | Promise<void>;
  pointerController?: DockPointerRegionController;
}
