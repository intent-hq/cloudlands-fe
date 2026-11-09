export type CommandPaletteAction = { type: 'create-file'; workspaceId: string };

export type SidebarLocateTarget = {
  sidebarTabId: string;
  type: string;
  noteId?: string;
  filePath?: string;
  agentId?: string;
  terminalId?: string;
  scriptId?: string;
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
  /**
   * Show the chat next to `sourcePanelId` while that pane stays visible and
   * focused: a chat open in another pane comes forward there, otherwise one
   * opens in the adjacent column.
   */
  alongsideSource?: boolean;
  targetPanelId?: string;
  panelLayoutId?: string;
  availablePanelCanvasWidth?: number;
  adaptiveFirstChat?: boolean;
};
