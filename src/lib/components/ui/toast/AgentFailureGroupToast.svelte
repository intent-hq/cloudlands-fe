<script lang="ts">
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import CopyButton from '$lib/components/ui/CopyButton.svelte';
  import { faTerminal } from '$lib/icons/phosphor-icons';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** "Claude Code usage or rate limit reached — 6 agents". */
    title: string;
    /** Truncated error of the newest member. */
    errorSummary: string;
    /** "Agent / Workspace" lines for the first few members. */
    members: string[];
    /** Members beyond `members`. */
    moreCount: number;
    /** Sign-in group: login command to run (copyable guidance). */
    loginCommandHint?: string;
    onRunLogin?: () => void;
    retrying: boolean;
    /** Brief note after a Retry all with failures. */
    retryNote?: string;
    onSwitchAll: () => void;
    onRetryAll: () => void;
    onClose: () => void;
  }

  let {
    title,
    errorSummary,
    members,
    moreCount,
    loginCommandHint,
    onRunLogin,
    retrying,
    retryNote,
    onSwitchAll,
    onRetryAll,
    onClose,
  }: Props = $props();
</script>

<div
  class="relative flex w-full min-w-0 items-start gap-2.5 pr-6"
  data-toast-layout="agent-failure-group"
>
  <span class="toast-first-line"><ToastGlyph variant="error" /></span>

  <div class="flex-1 min-w-0">
    <p class="toast-title min-w-0" data-toast-title>{title}</p>
    <p class="toast-description" data-toast-description>{errorSummary}</p>

    <div class="toast-members" data-testid="toast-group-members" data-toast-optional>
      {#each members as member, index (index)}
        <p class="min-w-0 truncate" title={member}>{member}</p>
      {/each}
      {#if moreCount > 0}
        <p>{m.agent_failureGroupToast_more_label({ count: moreCount })}</p>
      {/if}
    </div>

    {#if loginCommandHint}
      <div class="mt-1.5 flex min-w-0 items-center gap-1" data-testid="toast-auth-guidance">
        <code
          class="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 text-xs"
          title={loginCommandHint}>{loginCommandHint}</code
        >
        <CopyButton text={loginCommandHint} size="xs" />
        {#if onRunLogin}
          <Button
            variant="ghost"
            size="icon-compact"
            class="[&_svg]:size-3"
            iconOnly
            tooltip={m.chat_failureRecovery_runInTerminal_label()}
            aria-label={m.chat_failureRecovery_runInTerminal_label()}
            onclick={onRunLogin}
            data-testid="toast-auth-run-in-terminal"
          >
            <Fa icon={faTerminal} size="xs" />
          </Button>
        {/if}
      </div>
    {/if}

    {#if retryNote}
      <p class="text-xs text-danger mt-1.5" data-toast-description data-toast-optional>
        {retryNote}
      </p>
    {/if}

    <div class="toast-actions">
      <Button variant="outline" size="compact" class="toast-action" onclick={onSwitchAll}>
        {m.agent_failureGroupToast_switchAll_label()}
      </Button>
      <Button
        variant="ghost"
        size="compact"
        class="toast-action"
        disabled={retrying}
        onclick={onRetryAll}
      >
        {retrying
          ? m.ui_agentFailureToast_retrying_label()
          : m.agent_failureGroupToast_retryAll_label()}
      </Button>
    </div>
  </div>

  <ToastCloseButton onclick={onClose} ariaLabel={m.ui_agentFailureToast_close_ariaLabel()} />
</div>

<style>
  .toast-title,
  .toast-first-line {
    color: hsl(var(--foreground));
    font-size: var(--toast-title-size, 0.8125rem);
    font-weight: 500;
    line-height: 1.4;
  }

  .toast-description {
    margin-top: 0.25rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--toast-description-size, 0.8125rem);
    line-height: 1.4;
  }

  .toast-members {
    display: grid;
    gap: 0.125rem;
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: 0.8125rem;
    line-height: 1.4;
  }

  .toast-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: 0.75rem;
  }

  :global(.toast-action) {
    min-height: var(--toast-action-height, var(--control-height-compact));
    border-radius: var(--toast-action-radius, var(--radius));
  }
</style>
