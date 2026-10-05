<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import * as Accordion from '$lib/components/ui/accordion';
  import { Button } from '$lib/components/ui/button';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { faExternalLink } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  interface Props {
    open?: boolean;
    static?: boolean;
    onClose?: () => void;
    onRetryInTerminal?: () => void;
    errorMessage?: string;
    /** The raw error output from git (stderr) for debugging */
    rawError?: string;
    operation?: string;
    command?: string;
    cwd?: string;
    workspaceId?: string;
  }

  let {
    open = false,
    static: staticPosition = false,
    onClose = () => {},
    onRetryInTerminal,
    errorMessage = '',
    rawError,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    operation = 'push',
    command,
    cwd,
    workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined,
  }: Props = $props();

  // Determine error type for conditional display
  // Use raw error for display if available, otherwise fall back to user-friendly message
  const displayError = $derived(rawError || errorMessage);

  // Show retry button only when we have the command info
  const canRetry = $derived(!!command && !!cwd && !!onRetryInTerminal);

  function handleClose() {
    onClose();
  }

  function openGitHubSSHDocs() {
    if (workspaceId) {
      handleLink('https://docs.github.com/en/authentication/connecting-to-github-with-ssh', {
        workspaceId: WorkspaceId(workspaceId),
      });
    }
  }

  function openGitCredentialManagerDocs() {
    if (workspaceId) {
      handleLink('https://github.com/git-ecosystem/git-credential-manager', {
        workspaceId: WorkspaceId(workspaceId),
      });
    }
  }
</script>

{#if open}
  <ContentDialog
    {open}
    static={staticPosition}
    title={m.lib_gitCredentials_title()}
    closeLabel={m.lib_gitCredentials_closeModal_ariaLabel()}
    onClose={handleClose}
    size="lg"
  >
    {#if errorMessage}<p class="type-body text-subtle">{errorMessage}</p>{/if}
    <p class="type-caption text-muted-foreground">
      <strong>{m.lib_gitCredentials_note_before()}</strong>
      {m.lib_gitCredentials_note_after()}
    </p>
    <Accordion.Root type="multiple">
      {#if command || displayError}
        <Accordion.Item value="error"
          ><Accordion.Trigger>{m.lib_gitCredentials_failedOperation_label()}</Accordion.Trigger
          ><Accordion.Content>
            {#if command}<pre
                class="whitespace-pre-wrap break-all font-mono type-caption">{command}</pre>{/if}
            {#if displayError}<pre
                class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono type-caption text-subtle">{displayError}</pre>{/if}
          </Accordion.Content></Accordion.Item
        >
      {/if}
      <Accordion.Item value="ssh"
        ><Accordion.Trigger>{m.lib_gitCredentials_sshOption_title()}</Accordion.Trigger
        ><Accordion.Content>
          <p class="text-sm text-subtle mb-3">
            {m.lib_gitCredentials_sshOption_description()}
          </p>
          <div class="font-mono text-xs space-y-1 break-words">
            <p class="m-0">
              <span class="text-subtle">{m.lib_gitCredentials_generateKey_comment()}</span>
            </p>
            <!-- i18n-ignore (shell command) -->
            <p class="m-0">ssh-keygen -t ed25519 -C "your_email@example.com"</p>
            <p class="m-0 mt-2">
              <span class="text-subtle">{m.lib_gitCredentials_addToAgent_comment()}</span>
            </p>
            <!-- i18n-ignore (shell command) -->
            <p class="m-0">eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519</p>
          </div>
          <Button
            variant="ghost"
            class="mt-3 flex items-center gap-1 text-primary-ink"
            disabled={!workspaceId}
            onclick={openGitHubSSHDocs}
          >
            <Fa icon={faExternalLink} size="xs" />
            {m.lib_gitCredentials_sshGuide_label()}
          </Button>
        </Accordion.Content></Accordion.Item
      >
      <Accordion.Item value="gcm"
        ><Accordion.Trigger>{m.lib_gitCredentials_gcmOption_title()}</Accordion.Trigger
        ><Accordion.Content>
          <p class="text-sm text-subtle mb-3">
            {m.lib_gitCredentials_gcmOption_description()}
          </p>
          <div class="font-mono text-xs space-y-1 break-words">
            <p class="m-0">
              <span class="text-subtle">{m.lib_gitCredentials_installMacos_comment()}</span>
            </p>
            <!-- i18n-ignore (shell command) -->
            <p class="m-0">brew install git-credential-manager</p>
            <p class="m-0 mt-2">
              <span class="text-subtle">{m.lib_gitCredentials_configureGit_comment()}</span>
            </p>
            <!-- i18n-ignore (shell command) -->
            <p class="m-0">git credential-manager configure</p>
          </div>
          <Button
            variant="ghost"
            class="mt-3 flex items-center gap-1 text-primary-ink"
            disabled={!workspaceId}
            onclick={openGitCredentialManagerDocs}
          >
            <Fa icon={faExternalLink} size="xs" />
            {m.lib_gitCredentials_gcmDocs_label()}
          </Button>
        </Accordion.Content></Accordion.Item
      >
    </Accordion.Root>
    {#snippet footer()}
      <Button variant="ghost" onclick={handleClose}>{m.lib_gitCredentials_close_label()}</Button>
      {#if canRetry}<Button variant="primary" onclick={() => onRetryInTerminal?.()}
          >{m.lib_gitCredentials_tryInTerminal_label()}</Button
        >{/if}
    {/snippet}
  </ContentDialog>
{/if}
