export type CommandPaletteAction = { type: "create-file"; workspaceId: string };

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

export type ShowAgentDetail = {
  agentId: string;
};

export type OpenAgentTabDetail = {
  agentId: string;
  openInAdjacentPanel?: boolean;
  sourcePanelId?: string;
};

export type OpenTerminalTabDetail = {
  terminalId: string;
};

export type CreateWorkspaceForRepoDetail = {
  repositoryPath: string;
  workspaceId?: string;
  workspaceTitle?: string;
};

export type OpenNewSpaceModalDetail = {
  initialRepo?: { repoPath?: string };
};