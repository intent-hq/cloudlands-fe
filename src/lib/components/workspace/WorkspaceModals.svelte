<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import PullRequestCreator from './PullRequestCreator.svelte';
  import type { Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

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
      <h2 class="text-lg font-semibold text-foreground mb-4">{m.workspace_modals_createNewAgent_label()}</h2>

      <p class="text-sm text-subtle mb-4">
        {m.workspace_modals_createAgent_description()}
      </p>

      {#if createAgentError}
        <div class="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div class="flex items-start gap-2">
            <span class="text-red-500 text-lg">⚠️</span>
            <div class="flex-1">
              <p class="text-sm text-red-400 font-medium mb-1">{m.workspace_modals_createAgentFailed_error()}</p>
              <p class="text-xs text-red-300">{createAgentError}</p>

              {#if showAuthHelper}
                <div class="mt-3 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                  <p class="text-xs text-blue-300 mb-2">
                    <strong>{m.workspace_modals_howToFix_before()}</strong>
                    {m.workspace_modals_howToFix_after()}
                  </p>
                  <ol class="text-xs text-blue-200 space-y-2 ml-4 list-decimal">
                    <li>
                      {m.workspace_modals_openTerminalStep_label()}
                      <Button onclick={onOpenSystemTerminal}>{m.workspace_modals_openSystemTerminal_label()}</Button>
                    </li>
                    <li>
                      {m.workspace_modals_runInTerminal_before()}
                      <!-- i18n-ignore (shell command) -->
                      <code class="px-1 py-0.5 bg-black/30 rounded font-mono">auggie login</code>
                    </li>
                    <li>{m.workspace_modals_followPrompts_label()}</li>
                    <li>{m.workspace_modals_tryAgain_label()}</li>
                  </ol>
                  <p class="text-xs text-blue-300 mt-3 italic">
                    {m.workspace_modals_note_before()}
                    <!-- i18n-ignore (shell command) -->
                    <code class="px-1 py-0.5 bg-black/30 rounded font-mono">auggie login</code>
                    {m.workspace_modals_note_after()}
                  </p>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <div class="flex gap-2 justify-end">
        <Button variant="ghost" onclick={onCancelCreateAgent} disabled={creatingAgent}>
          {m.workspace_modals_cancel_label()}
        </Button>
        <Button onclick={onCreateAgent} disabled={creatingAgent}>
          {creatingAgent
            ? m.workspace_modals_creating_label()
            : m.workspace_modals_createAgent_label()}
        </Button>
      </div>
    </div>
  </div>
{/if}
