export type CommandPaletteAction = { type: 'create-file'; workspaceId: string };

export type SidebarLocateTarget = {
  sidebarTabId: string;
  type: string;
  noteId?: string;
  filePath?: string;
  agentId?: string;
  terminalId?: string;
};

export type PendingSidebarLocate = {
  workspaceId: string;
  target: SidebarLocateTarget;
};

export type AppLayoutState = {
  pendingCommandPaletteAction: CommandPaletteAction | null;
  pendingLocateInSidebar: PendingSidebarLocate | null;
};

export type OpenAgentTabDetail = {
  agentId: string;
  pin?: boolean;
  openInAdjacentPanel?: boolean;
  openInNewColumn?: boolean;
  sourcePanelId?: string;
  targetPanelId?: string;
  panelLayoutId?: string;
  availablePanelCanvasWidth?: number;
  adaptiveFirstChat?: boolean;
};
