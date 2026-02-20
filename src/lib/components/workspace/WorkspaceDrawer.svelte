<script lang="ts">
  /**
   * WorkspaceDrawer Component
   *
   * @component
   * @description Manages the workspace drawer overlay for displaying various content types.
   * Handles agent chat interactions, file viewing, notes, and terminal output.
   * Integrates with the workspace context to maintain state across the application.
   *
   * @example
   * ```svelte
   * <!-- Automatically rendered when drawer is opened via workspace context -->
   * <WorkspaceDrawer />
   * ```
   *
   * @context
   * Uses workspace context to determine:
   * - Whether drawer is open
   * - Type of content to display
   * - Content data to render
   *
   * @features
   * - Agent chat messaging with workspace context
   * - Dynamic content type rendering
   * - Automatic rules file loading
   * - Workspace context building for agents
   */
  import { logger } from '$lib/utils/client-logger';

  import { getWorkspaceContext } from '$features/workspace/workspace.context.svelte';
  import { agentService } from '$features/agent/agent.service';
  import ContentDrawer from '$lib/components/layout/ContentDrawer.svelte';
  import { buildWorkspaceContext } from '$features/agent/agent-launch-core';
  import { activeProviderStore } from '$lib/stores/active-provider.store.svelte';
  import { getAgentProvider } from '$shared/types/agent-session';
  import { getProviderConfig } from '$shared/config/provider-config';

  const ctx = getWorkspaceContext();

  async function handleSendMessage(messageData: any) {
    const message = messageData.content;

    if (!ctx.workspace || !ctx.drawerContent?.id) {
      logger.error('No workspace or agent selected');
      return;
    }

    // Provider mismatch guard — block sending if agent's provider ≠ active provider
    const session = agentService.getSession(ctx.drawerContent.id);
    if (session) {
      const agentProvider = getAgentProvider(session);
      if (agentProvider && agentProvider !== activeProviderStore.activeProviderId) {
        const agentProviderName = getProviderConfig(agentProvider).displayName;
        logger.error(`Cannot send message: agent uses ${agentProviderName}, which is not the active provider`);
        return;
      }
    }

    try {
      // Build workspace context for STDIN
      const workspacePath = ctx.workspace.worktreePath || ctx.workspace.repositoryPath || '';
      const workspaceContext = buildWorkspaceContext(
        workspacePath,
        [], // No context references for regular chat
      );

      // For chat messages, pass the message directly
      // Rules are loaded automatically by InstructionService based on agent type
      await agentService.sendMessage(ctx.drawerContent.id, message, ctx.workspace, {
        stdinContext: workspaceContext,
      });

      // The agent service handles updating the session internally
      // Get updated session to refresh UI
      const agent = agentService.getSession(ctx.drawerContent.id);
      if (agent) {
        ctx.drawerContent = {
          ...ctx.drawerContent,
          messages: agent.messages || [],
        };
      }
    } catch (error) {
      logger.error('Failed to send message:', error);
    }
  }
</script>

{#if ctx.drawerOpen && ctx.drawerContent}
  <div class="absolute inset-0 z-20 bg-background">
    {#if ctx.drawerType}
      {logger.info('[WorkspaceDrawer] Opening drawer with:', {
        drawerType: ctx.drawerType,
        hasContent: !!ctx.drawerContent,
        contentKeys: ctx.drawerContent ? Object.keys(ctx.drawerContent) : [],
      })}
    {/if}
    <ContentDrawer
      contentType={ctx.drawerType as
        | 'code'
        | 'agent'
        | 'file'
        | 'note'
        | 'diff'
        | 'notes'
        | undefined}
      content={ctx.drawerContent}
      workspaceId={ctx.workspace?.id || ''}
      executionMode="manual"
      onClose={() => ctx.closeDrawer?.()}
      onSendMessage={handleSendMessage}
      onStopGeneration={() => logger.info('Stop generation')}
    />
  </div>
{/if}
