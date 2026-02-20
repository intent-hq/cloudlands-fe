<script lang="ts">
  import { Fa } from 'svelte-fa';
  import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('PanelVisibilityDebugControls');

  let {
    onClose,
  }: {
    onClose?: () => void;
  } = $props();

  // Debug functions for panel visibility
  function emitPanelEvent(eventName: string) {
    logger.info(`Emitting panel visibility event: ${eventName}`);
    window.dispatchEvent(new CustomEvent(eventName));
    onClose?.();
  }

  // ContentNavigationRail panels
  function showNotesPanel() {
    emitPanelEvent('panelVisibility:showNotes');
  }

  function hideNotesPanel() {
    emitPanelEvent('panelVisibility:hideNotes');
  }

  function showCodeChangesPanel() {
    emitPanelEvent('panelVisibility:showCodeChanges');
  }

  function hideCodeChangesPanel() {
    emitPanelEvent('panelVisibility:hideCodeChanges');
  }

  function showFilesPanel() {
    emitPanelEvent('panelVisibility:showFiles');
  }

  function hideFilesPanel() {
    emitPanelEvent('panelVisibility:hideFiles');
  }

  function showActivityLogPanel() {
    emitPanelEvent('panelVisibility:showActivityLog');
  }

  function hideActivityLogPanel() {
    emitPanelEvent('panelVisibility:hideActivityLog');
  }

  function hideNavigationRail() {
    emitPanelEvent('panelVisibility:hideNavigationRail');
  }

  function showNavigationRail() {
    emitPanelEvent('panelVisibility:showNavigationRail');
  }

  // WorkspaceDock panels
  function showWorkspaceDock() {
    emitPanelEvent('panelVisibility:showWorkspaceDock');
  }

  function hideWorkspaceDock() {
    emitPanelEvent('panelVisibility:hideWorkspaceDock');
  }

  function showAgentNavRail() {
    emitPanelEvent('panelVisibility:showAgentNavRail');
  }

  function hideAgentNavRail() {
    emitPanelEvent('panelVisibility:hideAgentNavRail');
  }

  function showTerminalNavRail() {
    emitPanelEvent('panelVisibility:showTerminalNavRail');
  }

  function hideTerminalNavRail() {
    emitPanelEvent('panelVisibility:hideTerminalNavRail');
  }

  // Chat Focused Mode
  function enableChatFocusedMode() {
    emitPanelEvent('panelVisibility:chatFocusedModeTrue');
  }

  function disableChatFocusedMode() {
    emitPanelEvent('panelVisibility:chatFocusedModeFalse');
  }

  // Main Content
  function showMainContent() {
    emitPanelEvent('panelVisibility:showMainContent');
  }

  function hideMainContent() {
    emitPanelEvent('panelVisibility:hideMainContent');
  }

  // Chat Header
  function showChatHeader() {
    emitPanelEvent('panelVisibility:showChatHeader');
  }

  function hideChatHeader() {
    emitPanelEvent('panelVisibility:hideChatHeader');
  }
</script>

<!-- Debug Panel Visibility Controls -->
<div class="my-1 h-px bg-border"></div>
<div class="px-2 py-1 text-xs text-muted-foreground font-medium">Debug Panel Controls</div>

<!-- ContentNavigationRail Controls -->
<div class="px-2 py-1 text-xs text-muted-foreground font-medium">Navigation Rail</div>
<div class="grid grid-cols-2 gap-1">
  <Button variant="ghost" onclick={showNotesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Notes</span>
  </Button>
  <Button variant="ghost" onclick={hideNotesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Notes</span>
  </Button>

  <Button variant="ghost" onclick={showCodeChangesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Code</span>
  </Button>
  <Button variant="ghost" onclick={hideCodeChangesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Code</span>
  </Button>

  <Button variant="ghost" onclick={showFilesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Files</span>
  </Button>
  <Button variant="ghost" onclick={hideFilesPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Files</span>
  </Button>

  <Button variant="ghost" onclick={showActivityLogPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Activity</span>
  </Button>
  <Button variant="ghost" onclick={hideActivityLogPanel} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Activity</span>
  </Button>

  <Button variant="ghost" onclick={showNavigationRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Rail</span>
  </Button>
  <Button variant="ghost" onclick={hideNavigationRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Rail</span>
  </Button>
</div>

<!-- WorkspaceDock Controls -->
<div class="px-2 py-1 text-xs text-muted-foreground font-medium mt-2">Space Dock</div>
<div class="grid grid-cols-2 gap-1">
  <Button variant="ghost" onclick={showWorkspaceDock} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Dock</span>
  </Button>
  <Button variant="ghost" onclick={hideWorkspaceDock} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Dock</span>
  </Button>

  <Button variant="ghost" onclick={showAgentNavRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Agents</span>
  </Button>
  <Button variant="ghost" onclick={hideAgentNavRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Agents</span>
  </Button>

  <Button variant="ghost" onclick={showTerminalNavRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Terminals</span>
  </Button>
  <Button variant="ghost" onclick={hideTerminalNavRail} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Terminals</span>
  </Button>
</div>

<!-- Chat Focused Mode Controls -->
<div class="px-2 py-1 text-xs text-muted-foreground font-medium mt-2">Chat Focused Mode</div>
<div class="grid grid-cols-2 gap-1">
  <Button variant="ghost" onclick={enableChatFocusedMode} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Enable</span>
  </Button>
  <Button variant="ghost" onclick={disableChatFocusedMode} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Disable</span>
  </Button>
</div>

<!-- Main Content Controls -->
<div class="px-2 py-1 text-xs text-muted-foreground font-medium mt-2">Main Content</div>
<div class="grid grid-cols-2 gap-1">
  <Button variant="ghost" onclick={showMainContent} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Show</span>
  </Button>
  <Button variant="ghost" onclick={hideMainContent} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Hide</span>
  </Button>
</div>

<!-- Chat Header Controls -->
<div class="px-2 py-1 text-xs text-muted-foreground font-medium mt-2">Chat Header</div>
<div class="grid grid-cols-2 gap-1">
  <Button variant="ghost" onclick={showChatHeader} class="justify-start text-xs" size="sm">
    <Fa icon={faEye} size="xs" class="mr-1 opacity-50" />
    <span>Show</span>
  </Button>
  <Button variant="ghost" onclick={hideChatHeader} class="justify-start text-xs" size="sm">
    <Fa icon={faEyeSlash} size="xs" class="mr-1 opacity-50" />
    <span>Hide</span>
  </Button>
</div>
