export const CHIEF_WORKSPACE_ID = '__chief__';
// i18n-ignore (sentinel compared against daemon-stored names; localizing would break placeholder detection)
export const DEFAULT_CHIEF_THREAD_TITLE = 'New chat';

export type ChiefThreadSummary = {
  agentId: string;
  title: string;
  isActive: boolean;
  messageCount: number;
};

export type SidebarNavState = {
  panelItem: 'chief' | null;
  onboardingActive: boolean;
  showCreateModal: boolean;
  pinnedWorkspaceIds: string[];
  multiSelectTabOrder: string[];
  multiSelectSelectedTabIdsByWorkspaceId: Record<string, string[]>;
  noteOrderByWorkspaceId: Record<string, string[]>;
  collapsedNoteIdsByWorkspaceId: Record<string, string[]>;
  chiefActiveAgentId: string | null;
  statsOverlayOpen: boolean;
};
