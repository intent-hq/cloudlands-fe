<script lang="ts" module>
  import { dockRailPreview } from './dock-rail.preview-fixtures';
  export const preview = dockRailPreview;
</script>

<script lang="ts">
  import type { DockPointerRect } from '$shared/dock-layout';
  import {
    dockWindowEnvelope,
    dockLocalRect,
    resolveFloatingDockGeometry,
    resolveDockSurface,
    resolveDockSidePanelSurface,
    DOCK_FLOATING_SHADOW_MARGIN,
    type DockPlacementCommand,
    type DockPlacementSnapshot,
  } from '$shared/dock-placement';
  import { adaptiveDockFixture } from './dock-rail.preview-fixtures';
  import type { DockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import DockRail from './DockRail.svelte';
  import DockConversationPanel from './DockConversationPanel.svelte';
  import { conversationMessages } from './dock-conversation.preview-fixtures';
  import type { DockConversationMessage } from '$store/renderer/slices/dock-conversation/dock-conversation-types';
  import type { DockRailPreviewProps } from './dock-rail.preview-fixtures';

  let {
    workspaces,
    viewportHeight,
    viewportWidth,
    theme,
    placement: initialPlacement,
    failFeedbackOnce = false,
    focusRequest = 0,
    placementError = false,
    floatingDisplay,
    controlledPlacement = false,
    manualResizeAcknowledgements = false,
    conversationFixture = false,
    resizeAcknowledgement = 'accept',
  }: DockRailPreviewProps = $props();
  let dragStartResult = $state<{ id: number; token: string | null } | null>(null);
  let resizeStartResult = $state<{ id: number; token: string | null } | null>(null);
  let pendingResizeAcknowledgement: (() => void) | null = null;
  $effect(() => {
    const release = () => {
      pendingResizeAcknowledgement?.();
      pendingResizeAcknowledgement = null;
    };
    window.addEventListener('dock-preview-resize-ack', release);
    return () => {
      pendingResizeAcknowledgement = null;
      window.removeEventListener('dock-preview-resize-ack', release);
    };
  });
  let commands = $state<DockPlacementCommand[]>([]);
  let conversationWorkspaceId = $state<string | null>(null);
  let selectedAgents = $state<Record<string, string>>({});
  let conversationDrafts = $state<Record<string, string>>({});
  let conversationHistory = $state<Record<string, DockConversationMessage[]>>({});
  let submissions = $state<{ workspaceId: string; agentId: string; text: string }[]>([]);
  const conversationAgents = $derived(
    ['main', 'sub'].map((kind) => ({
      id: `${conversationWorkspaceId}:${kind}`,
      name: kind === 'main' ? 'Workspace coordinator' : 'Navigation specialist',
      isMain: kind === 'main',
    })),
  );
  const conversationAgentId = $derived(
    conversationWorkspaceId
      ? (selectedAgents[conversationWorkspaceId] ?? `${conversationWorkspaceId}:main`)
      : '',
  );
  const conversationTitle = $derived(
    conversationWorkspaceId === '__chief__'
      ? 'Assistant'
      : (workspaces.find((item) => item.workspace.id === conversationWorkspaceId)?.workspace
          .title ?? 'Workspace'),
  );
  function openConversation(id: string): void {
    conversationWorkspaceId = id;
    recordAction(`conversation:${id}`);
  }
  function closeConversation(): void {
    conversationWorkspaceId = null;
    recordAction('conversation:back');
  }
  // Presentation boundary only: no store service, transport, or live send is invoked.
  function sendConversation(): void {
    if (!conversationWorkspaceId) return;
    const text = conversationDrafts[conversationAgentId] ?? '';
    submissions = [
      ...submissions,
      { workspaceId: conversationWorkspaceId, agentId: conversationAgentId, text },
    ];
    conversationHistory = {
      ...conversationHistory,
      [conversationAgentId]: [
        ...(conversationHistory[conversationAgentId] ?? conversationMessages),
        {
          id: `sent-${submissions.length}`,
          role: 'user',
          timestamp: new Date().toISOString(),
          contentBlocks: [{ type: 'text', text }],
        },
      ],
    };
    conversationDrafts = { ...conversationDrafts, [conversationAgentId]: '' };
  }
  $effect(() => {
    if (!conversationFixture) return;
    const receive = (event: Event) => {
      const { agentId, message } = (
        event as CustomEvent<{ agentId: string; message: DockConversationMessage }>
      ).detail;
      const history = conversationHistory[agentId] ?? conversationMessages;
      const index = history.findIndex((item) => item.id === message.id);
      conversationHistory = {
        ...conversationHistory,
        [agentId]:
          index < 0
            ? [...history, message]
            : history.map((item) => (item.id === message.id ? message : item)),
      };
    };
    window.addEventListener('dock-preview-conversation-message', receive);
    return () => window.removeEventListener('dock-preview-conversation-message', receive);
  });
  let requestedSidePanel: { width: number; height: number } | null = null;
  let requestedExpansionDirection: 'up' | 'down' | null = null;
  let resizeOriginal: {
    placement: DockPlacementSnapshot;
    sidePanel: { width: number; height: number } | null;
    direction: 'up' | 'down' | null;
  } | null = null;
  let feedbackFailed = false;
  let lastAction = $state('');
  let actionHistory = $state<string[]>([]);
  let pointerState = $state<{ active: boolean; regions: DockPointerRect[]; revision?: number }>({
    active: false,
    regions: [],
  });
  function recordAction(action: string): void {
    lastAction = action;
    actionHistory = [...actionHistory, action];
  }
  let placement = $state<DockPlacementSnapshot>();
  $effect(() => {
    placement = initialPlacement;
  });
  $effect(() => {
    if (!floatingDisplay) return;
    // The browser page represents a synthetic display (including negative origins).
    // Preserve real browser capture while translating its OS coordinates at the fixture boundary.
    const translate = (event: PointerEvent) => {
      if (!event.isTrusted || !placement) return;
      const host = (event.target as Element | null)?.closest('.dock-preview-host');
      if (!host) return;
      const rect = host.parentElement?.getBoundingClientRect();
      if (!rect || !floatingDisplay) return;
      Object.defineProperties(event, {
        screenX: { value: event.clientX - rect.x + floatingDisplay.bounds.x },
        screenY: { value: event.clientY - rect.y + floatingDisplay.bounds.y },
      });
    };
    document.addEventListener('pointerdown', translate, true);
    document.addEventListener('pointermove', translate, true);
    document.addEventListener('pointerup', translate, true);
    return () => {
      document.removeEventListener('pointerdown', translate, true);
      document.removeEventListener('pointermove', translate, true);
      document.removeEventListener('pointerup', translate, true);
    };
  });
  $effect(() => {
    if (!controlledPlacement) return;
    const receive = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          placement: DockPlacementSnapshot;
          dragStartResult?: { id: number; token: string | null };
        }>
      ).detail;
      placement = detail.placement;
      if (detail.dragStartResult) dragStartResult = detail.dragStartResult;
    };
    window.addEventListener('dock-preview-placement', receive);
    return () => window.removeEventListener('dock-preview-placement', receive);
  });
  function onPlacementCommand(command: DockPlacementCommand): void {
    if (!placement) return;
    commands = [...commands, command];
    // Fake native acknowledgement boundary. Geometry below uses production resolvers;
    // this does not exercise Electron pointer routing or native gesture authorization.
    if (command.action === 'begin-resize') {
      const id = (resizeStartResult?.id ?? 0) + 1;
      if (
        resizeAcknowledgement === 'reject' ||
        command.revision !== placement.revision ||
        placement.resizeToken
      ) {
        resizeStartResult = { id, token: null };
        return;
      }
      resizeOriginal = {
        placement: JSON.parse(JSON.stringify(placement)),
        sidePanel: requestedSidePanel && { ...requestedSidePanel },
        direction: requestedExpansionDirection,
      };
      const token = `preview-resize-${id}`;
      const acknowledge = () => {
        if (!placement) return;
        placement = { ...placement, revision: placement.revision + 1, resizeToken: token };
        resizeStartResult = { id, token };
      };
      if (resizeAcknowledgement === 'defer') pendingResizeAcknowledgement = acknowledge;
      else acknowledge();
      return;
    }
    if (command.action === 'end-resize' || command.action === 'cancel-resize') {
      if (command.token !== placement.resizeToken) return;
      const revision = placement.revision + 1;
      if (command.action === 'cancel-resize' && resizeOriginal) {
        requestedSidePanel = resizeOriginal.sidePanel;
        requestedExpansionDirection = resizeOriginal.direction;
        placement = { ...resizeOriginal.placement, revision, resizeToken: null };
      } else placement = { ...placement, revision, resizeToken: null };
      resizeOriginal = null;
      return;
    }
    if (command.action === 'move') {
      placement = {
        ...adaptiveDockFixture(
          command.target === 'left' || command.target === 'right'
            ? 'edge'
            : command.target === 'floating'
              ? 'floating'
              : 'notch',
          command.target === 'left' ? 'left' : 'right',
        ),
        revision: placement.revision + 1,
      };
      recordAction(`placement:${command.target}`);
    } else if (command.action === 'resize') {
      // Trajectory fixtures supply native commit/resize replies independently, including
      // retained envelopes. Keep recording the real renderer request before deferring.
      if (manualResizeAcknowledgements) return;
      if (
        placement.resizeToken
          ? command.resizeToken !== placement.resizeToken
          : command.resizeToken !== undefined
      )
        return;
      if (command.expansionDirection !== undefined)
        requestedExpansionDirection = command.expansionDirection;
      if (floatingDisplay && placement.placement.kind === 'edge') {
        if (command.sidePanelSize !== undefined) requestedSidePanel = command.sidePanelSize;
        const rail = resolveDockSurface(placement.placement, floatingDisplay, command);
        const panel = requestedSidePanel
          ? resolveDockSidePanelSurface(
              rail,
              floatingDisplay,
              requestedSidePanel,
              placement.placement.side,
            )
          : null;
        const windowBounds = dockWindowEnvelope(
          rail,
          floatingDisplay,
          null,
          placement.placement.side,
          true,
          24,
          panel,
        );
        const surface = dockLocalRect(rail, windowBounds);
        const sidePanel = panel ? dockLocalRect(panel, windowBounds) : null;
        if (
          JSON.stringify({ surface, sidePanel, windowBounds }) ===
          JSON.stringify({
            surface: placement.surface,
            sidePanel: placement.sidePanel ?? null,
            windowBounds: placement.windowBounds,
          })
        )
          return;
        placement = {
          ...placement,
          revision: placement.revision + 1,
          surface,
          sidePanel,
          windowBounds,
          workArea: dockLocalRect(floatingDisplay.workArea, windowBounds),
        };
        return;
      }
      if (floatingDisplay && placement.placement.kind === 'floating') {
        const geometry = resolveFloatingDockGeometry(
          placement.placement,
          floatingDisplay,
          command,
          requestedExpansionDirection,
        );
        const windowBounds = dockWindowEnvelope(
          geometry.surface,
          floatingDisplay,
          null,
          null,
          true,
          DOCK_FLOATING_SHADOW_MARGIN,
        );
        const surface = dockLocalRect(geometry.surface, windowBounds);
        const floatingAnchor = dockLocalRect(geometry.anchor, windowBounds);
        if (
          JSON.stringify({
            surface,
            windowBounds,
            floatingAnchor,
            expansionDirection: geometry.expansionDirection,
          }) ===
          JSON.stringify({
            surface: placement.surface,
            windowBounds: placement.windowBounds,
            floatingAnchor: placement.floatingAnchor,
            expansionDirection: placement.expansionDirection,
          })
        )
          return;
        placement = {
          ...placement,
          revision: placement.revision + 1,
          surface,
          windowBounds,
          floatingAnchor,
          expansionDirection: geometry.expansionDirection,
          workArea: dockLocalRect(floatingDisplay.workArea, windowBounds),
        };
        return;
      }
      const width = Math.min(640, command.width);
      const height = Math.min(600, command.height);
      if (placement.surface.width === width && placement.surface.height === height) return;
      const mode = placement.placement;
      const x = mode.kind === 'edge' ? (mode.side === 'left' ? 0 : 640 - width) : (640 - width) / 2;
      const y = mode.kind === 'notch' ? (placement.shape === 'notch' ? 0 : 24) : (600 - height) / 2;
      placement = {
        ...placement,
        revision: placement.revision + 1,
        surface: { x, y, width, height },
      };
    }
  }
  $effect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const wasLight = root.classList.contains('light');
    const wasDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', wasLight);
      root.classList.toggle('dark', wasDark);
    };
  });
  const pointerController: DockPointerRegionController = {
    activate: (regions, revision) => {
      pointerState = { active: true, regions, revision };
    },
    deactivate: (regions = [], revision) => {
      pointerState = { active: false, regions, revision };
    },
    destroy: () => {
      pointerState = { active: false, regions: [] };
    },
  };
</script>

{#snippet conversationContent()}
  <DockConversationPanel
    conversationKey={conversationAgentId}
    agentId={conversationAgentId}
    agents={conversationAgents}
    workspaceTitle={conversationTitle}
    messages={conversationHistory[conversationAgentId] ?? conversationMessages}
    draft={conversationDrafts[conversationAgentId] ?? ''}
    onDraftChange={(text) =>
      (conversationDrafts = { ...conversationDrafts, [conversationAgentId]: text })}
    onSelectAgent={(id) => {
      if (conversationWorkspaceId)
        selectedAgents = { ...selectedAgents, [conversationWorkspaceId]: id };
    }}
    onSend={sendConversation}
    onRetrySend={sendConversation}
    onBack={closeConversation}
    onOpenWorkspace={() =>
      recordAction(`full-chat:${conversationWorkspaceId}:${conversationAgentId}`)}
    onRetryLoad={() => recordAction('conversation:reload')}
  />
{/snippet}

<div
  data-preview-conversation={conversationWorkspaceId ?? ''}
  data-preview-submissions={JSON.stringify(submissions)}
  data-preview-drafts={JSON.stringify(conversationDrafts)}
  data-preview-action={lastAction}
  data-preview-actions={JSON.stringify(actionHistory)}
  data-preview-pointer={JSON.stringify(pointerState)}
  data-preview-placement={JSON.stringify(placement)}
  data-preview-commands={JSON.stringify(commands)}
  style:position={floatingDisplay ? 'relative' : undefined}
  style:width={floatingDisplay ? `${floatingDisplay.bounds.width}px` : undefined}
  style:height={floatingDisplay ? `${floatingDisplay.bounds.height}px` : undefined}
>
  <section
    class="dock-preview-host relative max-w-full overflow-clip bg-background"
    style:transition-property="none"
    style:position={floatingDisplay ? 'absolute' : undefined}
    style:left={floatingDisplay && placement
      ? `${placement.windowBounds.x - floatingDisplay.bounds.x}px`
      : undefined}
    style:top={floatingDisplay && placement
      ? `${placement.windowBounds.y - floatingDisplay.bounds.y}px`
      : undefined}
    style:height={`${floatingDisplay && placement ? placement.windowBounds.height : viewportHeight}px`}
    style:width={floatingDisplay && placement
      ? `${placement.windowBounds.width}px`
      : viewportWidth
        ? `${viewportWidth}px`
        : '100%'}
    data-dock-rail-preview
    data-preview-items={workspaces.length}
    data-preview-height={viewportHeight}
    data-preview-action={lastAction}
    data-preview-actions={JSON.stringify(actionHistory)}
    data-preview-pointer={JSON.stringify(pointerState)}
    data-preview-placement={JSON.stringify(placement)}
    data-preview-commands={JSON.stringify(commands)}
  >
    <DockRail
      {workspaces}
      conversation={conversationFixture ? conversationContent : undefined}
      {conversationWorkspaceId}
      onOpenConversation={conversationFixture ? openConversation : undefined}
      onCloseConversation={conversationFixture ? closeConversation : undefined}
      {placement}
      {focusRequest}
      {dragStartResult}
      {resizeStartResult}
      {placementError}
      {onPlacementCommand}
      viewportHeight={floatingDisplay && placement ? placement.windowBounds.height : viewportHeight}
      {pointerController}
      staticData
      onOpenWorkspace={(id) => {
        recordAction(`workspace:${id}`);
      }}
      onOpenAssistant={() => {
        recordAction('assistant');
      }}
      onOpenHud={() => {
        recordAction('hud');
      }}
      onAnnotate={async (request) => {
        if (failFeedbackOnce && !feedbackFailed) {
          feedbackFailed = true;
          throw new Error('Synthetic capture unavailable');
        }
        recordAction(`feedback:${request.workspaceId}`);
      }}
    />
  </section>
</div>
