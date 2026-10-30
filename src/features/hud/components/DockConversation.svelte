<script lang="ts">
  import { untrack } from 'svelte';
  import DockConversationQuestions from './DockConversationQuestions.svelte';
  import { pendingQuestionRecoveryRequested } from '$store/renderer/slices/chat-state/chat-state-slice';
  import DockConversationPanel from './DockConversationPanel.svelte';
  import DockConversationComposer, {
    type DockConversationComposerSubmission,
  } from './DockConversationComposer.svelte';
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import { isAutomatedChatMessage } from '$lib/utils/previous-user-message';
  import type { ContextItem } from '$lib/components/chat/input/context-api';
  import { agentSessionStopChatRequested } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectDockConversationView,
    selectDockConversationComposer,
    selectDockConversationScope,
    selectCurrentDockComposerEvidence,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { selectComposerContextItems } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import {
    createDockComposerController,
    type DockComposerController,
    type DockComposerLocalState,
    type DockComposerScope,
  } from '$features/hud/composer/dock-composer-controller';
  import { buildDockComposerMedia } from '$features/hud/composer/dock-composer-presentation';
  import { dockAnnotationBarMedia } from '$features/hud/composer/dock-annotation-bar-media';
  import {
    createDockComposerFilePolicy,
    createDockComposerLabels,
  } from '$features/hud/composer/dock-composer-labels';
  import { m } from '$shared/paraglide/messages.js';
  import { markAgentSeenAtBoundary } from '$features/agent/mark-agent-seen';
  import { getDockConversationNoticeHost } from './DockConversationNotifications.svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import {
    closeDockConversationRequested,
    selectDockConversationAgentRequested,
    dockConversationDraftChanged,
    dockConversationContextItemsChanged,
    sendDockConversationRequested,
    retryDockConversationSendRequested,
    reloadDockConversationRequested,
    dockEvidenceBarMediaChanged,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';

  let {
    onOpenWorkspace,
  }: { onOpenWorkspace: (workspaceId: string, agentId: string | null) => void } = $props();
  const view$ = selectDockConversationView();
  let questionCollapsed = $state(false);
  const composer$ = selectDockConversationComposer();
  const scope$ = selectDockConversationScope();
  const currentEvidence$ = selectCurrentDockComposerEvidence();
  const labels = createDockComposerLabels();

  // One UI-only composer controller per open pair and authority; retired with it.
  // The native session and speech belong to the root native-session saga.
  let controller = $state.raw<DockComposerController | null>(null);
  let mediaLocal = $state.raw<DockComposerLocalState | null>(null);
  let composerInstance = $state<DockConversationComposer>();
  $effect(() => {
    const key = $scope$;
    if (!key) return;
    const scope = JSON.parse(key) as DockComposerScope;
    const next = createDockComposerController(scope);
    controller = next;
    const stopLocal = next.local.subscribe((state) => (mediaLocal = state));
    return () => {
      stopLocal();
      next.dispose();
      if (controller === next) controller = null;
      mediaLocal = null;
    };
  });
  /** The open pair's evidence, only while it belongs to the live controller. */
  const evidence = $derived.by(() => {
    const current = $currentEvidence$;
    const owner = controller;
    return current &&
      owner &&
      current.workspaceId === owner.scope.workspaceId &&
      current.agentId === owner.scope.agentId
      ? current.view
      : null;
  });
  $effect(() => {
    const view = evidence;
    const owner = controller;
    if (!view || !owner) return;
    untrack(() => {
      owner.syncTicker(view);
      void owner.refreshPreviews(
        view,
        selectComposerContextItems.select(
          appStore.state,
          owner.scope.workspaceId,
          owner.scope.agentId,
        ),
      );
    });
  });
  /** Media binding only for the composer of the controller's own pair. */
  function mediaFor(workspaceId: string, agentId: string) {
    const owner = controller;
    if (
      !owner ||
      !evidence ||
      !mediaLocal ||
      owner.scope.workspaceId !== workspaceId ||
      owner.scope.agentId !== agentId
    )
      return null;
    return {
      media: buildDockComposerMedia({
        workspaceId,
        view: evidence,
        items: $composer$.contextItems,
        local: mediaLocal,
        labels,
        actions: owner.actions,
        copy: {
          idle: m.dock_composer_idle_placeholder({
            agent: $view$.agents.find((row) => row.id === agentId)?.name ?? '',
          }),
          captured: m.dock_composer_captured_placeholder(),
          annotating: m.dock_composer_annotating_placeholder(),
          permission: m.dock_composer_screenPermission_tooltip(),
          openSettings: m.annotation_startPermission_openSettings_label(),
          speechPermission: m.dock_composer_speechPermission_error(),
          accessibilityPermission: m.dock_composer_accessibilityPermission_tooltip(),
          annotationUnavailable: m.dock_composer_annotationUnavailable_error(),
        },
        beforeSubmit: () =>
          owner.beforeSubmit(() => composerInstance?.flushScreenEvidence() ?? false),
      }),
      references: owner.references(evidence, labels),
      insertions: evidence.insertions,
      interim: evidence.dictation?.interim ?? [],
      // Evidence screenshots and the clip never consume ordinary file slots.
      filePolicy: createDockComposerFilePolicy(
        evidence.fileAttachmentsEnabled,
        evidence.evidenceOwnedItemIds,
      ),
      owner,
    };
  }
  // The annotate tool bar mirrors the composer's Screenshot and Record buttons:
  // send their state whenever it changes (the timer ticks in the bar itself).
  let sentBarMedia = '';
  $effect(() => {
    const workspaceId = $composer$.workspace?.id;
    const agentId = $composer$.agentId;
    const view = evidence;
    const bound = workspaceId && agentId ? mediaFor(workspaceId, agentId) : null;
    if (!workspaceId || !agentId || !view || !bound) return;
    const recording = view.clips.find((clip) => clip.status === 'recording');
    const media = dockAnnotationBarMedia(
      bound.media.state,
      labels,
      recording?.startedAt ?? null,
      $view$.sending,
    );
    const key = JSON.stringify([workspaceId, agentId, media]);
    if (key === sentBarMedia) return;
    sentBarMedia = key;
    untrack(() => appStore.dispatch(dockEvidenceBarMediaChanged(workspaceId, agentId, media)));
  });
  $effect(() => {
    const view = $view$;
    if (view.agentId && !view.loading && view.questionRecovery?.shouldRequest) {
      appStore.dispatch(
        pendingQuestionRecoveryRequested(view.agentId, view.questionRecovery.messageId),
      );
    }
  });
  // Seeing the conversation in the dock reads it, as viewing does in the app: the
  // workspace's unread clears on open and stays clear while new replies arrive.
  const surfaceHost = getDockConversationNoticeHost();
  $effect(() => {
    const view = $view$;
    const latest = view.messages.at(-1)?.id;
    if (!surfaceHost?.active || !view.agentId || view.loading || !latest) return;
    markAgentSeenAtBoundary([view.agentId]);
  });
  const historyNavigation = new Map<
    string,
    { index: number; draft: string; applied: string | null }
  >();

  function samePair(workspaceId: string, agentId: string): boolean {
    const current = selectDockConversationView.select(appStore.state);
    return current.workspaceId === workspaceId && current.agentId === agentId;
  }
  function changeComposerText(workspaceId: string, agentId: string, text: string): void {
    if (!samePair(workspaceId, agentId)) return;
    const key = JSON.stringify([workspaceId, agentId]);
    const navigation = historyNavigation.get(key);
    if (navigation?.applied === text) navigation.applied = null;
    else historyNavigation.delete(key);
    appStore.dispatch(dockConversationDraftChanged(workspaceId, agentId, text));
  }
  function changeContext(workspaceId: string, agentId: string, items: ContextItem[]): void {
    if (!samePair(workspaceId, agentId)) return;
    appStore.dispatch(
      dockConversationContextItemsChanged(
        workspaceId,
        agentId,
        items.map(({ file: _file, ...item }) => item),
      ),
    );
  }
  function submit(
    workspaceId: string,
    agentId: string,
    snapshot: DockConversationComposerSubmission,
  ): void {
    if (!samePair(workspaceId, agentId)) return;
    historyNavigation.delete(JSON.stringify([workspaceId, agentId]));
    appStore.dispatch(sendDockConversationRequested({ workspaceId, agentId, ...snapshot }));
  }
  function stop(workspaceId: string, agentId: string): void {
    if (
      !samePair(workspaceId, agentId) ||
      selectDockConversationView.select(appStore.state).draftDisabled
    )
      return;
    appStore.dispatch(agentSessionStopChatRequested(agentId));
  }
  function navigateHistory(workspaceId: string, agentId: string, direction: -1 | 1): string | null {
    if (!samePair(workspaceId, agentId)) return null;
    const view = selectDockConversationView.select(appStore.state);
    const history = view.messages
      .filter((row) => row.role === 'user' && !isAutomatedChatMessage(row))
      .map((row) => getPresentedUserMessageText(row, view.workspace?.ownerPrincipalId).trim())
      .filter(Boolean);
    if (!history.length) return null;
    const key = JSON.stringify([workspaceId, agentId]);
    const previous = historyNavigation.get(key);
    if (!previous && direction === 1) return null;
    const nav: { index: number; draft: string; applied: string | null } = previous ?? {
      index: history.length,
      draft: view.draft,
      applied: null,
    };
    nav.index = Math.max(0, Math.min(history.length, nav.index + direction));
    const text = nav.index === history.length ? nav.draft : history[nav.index];
    nav.applied = text;
    historyNavigation.set(key, nav);
    return text;
  }

  function changeDraft(text: string): void {
    const view = selectDockConversationView.select(appStore.state);
    if (view.workspaceId && view.agentId)
      appStore.dispatch(dockConversationDraftChanged(view.workspaceId, view.agentId, text));
  }
  function openWorkspace(): void {
    const view = selectDockConversationView.select(appStore.state);
    if (view.workspaceId) onOpenWorkspace(view.workspaceId, view.agentId);
  }
</script>

{#snippet composer()}
  {#if $composer$.workspace && $composer$.agentId}
    {@const workspaceId = $composer$.workspace.id}
    {@const agentId = $composer$.agentId}
    {@const bound = mediaFor(workspaceId, agentId)}
    <!-- The editor registers its chip node and interim speech only when created with
         references; the media binding arrives later, so always pass a list. -->
    {#key JSON.stringify([workspaceId, agentId])}
      <DockConversationComposer
        bind:this={composerInstance}
        {...$composer$}
        workspace={$composer$.workspace}
        {agentId}
        pending={$view$.sending}
        media={bound?.media}
        screenReferences={bound?.references ?? []}
        screenInsertions={bound?.insertions}
        screenInterim={bound?.interim}
        fileAttachmentPolicy={bound?.filePolicy}
        onScreenInsertionApplied={(id, committedText) =>
          bound?.owner.insertionApplied(id, committedText)}
        onUserTextInput={() => bound?.owner.userTyped()}
        onScreenReferencesEdited={(edit) => bound?.owner.referencesEdited(edit)}
        onValueChange={(text) => changeComposerText(workspaceId, agentId, text)}
        onContextItemsChange={(items) => changeContext(workspaceId, agentId, items)}
        onSubmit={(snapshot) => submit(workspaceId, agentId, snapshot)}
        onStop={() => stop(workspaceId, agentId)}
        onHistoryPrev={() => navigateHistory(workspaceId, agentId, -1)}
        onHistoryNext={() => navigateHistory(workspaceId, agentId, 1)}
      />
    {/key}
  {/if}
{/snippet}

{#snippet questions()}
  {#if $view$.questionContext}
    {@const context = $view$.questionContext}
    {#key JSON.stringify( [context.workspaceId, context.agentId, context.authority, context.generation, context.pending.messageId] )}
      <DockConversationQuestions {...context} bind:collapsed={questionCollapsed} />
    {/key}
  {/if}
{/snippet}

<DockConversationPanel
  questions={$view$.questionContext ? questions : undefined}
  questionsExpanded={!questionCollapsed}
  mediaStatus={$view$.workspaceId && $view$.agentId
    ? mediaFor($view$.workspaceId, $view$.agentId)?.media.mediaStatus
    : undefined}
  {composer}
  {...$view$}
  conversationKey={JSON.stringify([$view$.workspaceId, $view$.agentId])}
  onDraftChange={changeDraft}
  onSend={() => appStore.dispatch(sendDockConversationRequested())}
  onRetrySend={() => appStore.dispatch(retryDockConversationSendRequested())}
  onSelectAgent={(id) => appStore.dispatch(selectDockConversationAgentRequested(id))}
  onBack={() => appStore.dispatch(closeDockConversationRequested())}
  onOpenWorkspace={openWorkspace}
  onRetryLoad={() => appStore.dispatch(reloadDockConversationRequested())}
/>

<!-- Dock-level composer shortcuts. Capture phase so a live capture's Escape is
     consumed before the shell collapses the conversation; the controller skips
     IME, repeats, menus/lists/dialogs and editing keys while the field is focused. -->
<svelte:window onkeydowncapture={(event) => controller?.handleKey(event)} />

<!-- The dock renderer has no app-level host. Mounted inside the conversation's owned
     popup context, confirmations portal into the dock layer and get native hit regions. -->
<ConfirmHost />
