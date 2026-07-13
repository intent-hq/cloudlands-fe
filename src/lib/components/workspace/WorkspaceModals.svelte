<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import PullRequestCreator from './PullRequestCreator.svelte';
  import type { Workspace } from '$shared/types';

  interface Props {
    workspace: Workspace | null;
    showPRCreator?: boolean;
    showCreateAgentModal?: boolean;
    creatingAgent?: boolean;
    createAgentError?: string | null;
    showAuthHelper?: boolean;
    onPRCreatorClose?: () => void;
    onPRCreated?: (pr: any) => void;
    onCreateAgent?: () => void;
    onCancelCreateAgent?: () => void;
    onOpenSystemTerminal?: () => void;
  }

  let {
    workspace: _workspace,
    showPRCreator = false,
    showCreateAgentModal = false,
    creatingAgent = false,
    createAgentError = null,
    showAuthHelper = false,
    onPRCreatorClose,
    onPRCreated,
    onCreateAgent,
    onCancelCreateAgent,
    onOpenSystemTerminal,
  }: Props = $props();
</script>

<!-- Pull Request Creator -->
{#if showPRCreator}
  <PullRequestCreator onClose={() => onPRCreatorClose?.()} onCreated={(pr) => onPRCreated?.(pr)} />
{/if}

<!-- Create Agent Modal -->
{#if showCreateAgentModal}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={(e) =>
      (e.key === 'Enter' || e.key === 'Escape') && !creatingAgent && onCancelCreateAgent?.()}
    onclick={() => {
      if (!creatingAgent) {
        onCancelCreateAgent?.();
      }
    }}
  >
    <div
      class="bg-card rounded-lg shadow-lg w-full max-w-md p-6"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <h2 class="text-lg font-semibold text-foreground mb-4">Create New Agent</h2>

      <p class="text-sm text-subtle mb-4">
        A new agent will be created for this workspace. The agent will automatically name itself
        based on your conversation.
      </p>

      {#if createAgentError}
        <div class="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div class="flex items-start gap-2">
            <span class="text-red-500 text-lg">⚠️</span>
            <div class="flex-1">
              <p class="text-sm text-red-400 font-medium mb-1">Failed to create agent</p>
              <p class="text-xs text-red-300">{createAgentError}</p>

              {#if showAuthHelper}
                <div class="mt-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                  <p class="text-xs text-blue-300 mb-2">
                    <strong>How to fix:</strong> Auggie needs to be authenticated on the remote server.
                  </p>
                  <ol class="text-xs text-blue-200 space-y-2 ml-4 list-decimal">
                    <li>
                      Click the button below to open a system terminal connected to the remote
                      server
                      <Button onclick={onOpenSystemTerminal}>Open System Terminal</Button>
                    </li>
                    <li>
                      In the terminal, run: <code class="px-1 py-0.5 bg-black/30 rounded font-mono"
                        >auggie login</code
                      >
                    </li>
                    <li>Follow the authentication prompts in your browser</li>
                    <li>Once authenticated, try creating the agent again</li>
                  </ol>
                  <p class="text-xs text-blue-300 mt-3 italic">
                    Note: <code class="px-1 py-0.5 bg-black/30 rounded font-mono">auggie login</code
                    > is an interactive command that requires a browser, so it must be run in a system
                    terminal.
                  </p>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onclick={onCancelCreateAgent} disabled={creatingAgent}>
          Cancel
        </Button>
        <Button onclick={onCreateAgent} disabled={creatingAgent}>
          {creatingAgent ? 'Creating...' : 'Create Agent'}
        </Button>
      </div>
    </div>
  </div>
{/if}
