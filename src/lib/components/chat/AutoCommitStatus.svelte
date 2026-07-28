<script lang="ts">
  /**
   * Auto-Commit Status (per-turn)
   *
   * Pure display component for auto-commit lifecycle status inline in the chat panel.
   * Data fetching is handled by the parent (ChatPanel) to avoid N IPC calls and N*3
   * event listeners when many turns are rendered.
   */

  import Fa from 'svelte-fa';
  import {
  faCodeCommit,
  faSpinner,
} from '@fortawesome/free-solid-svg-icons';

  import { openWorkspaceCommitChangeset } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';

  export type CommitStatus =
    | { state: 'committing' }
    | { state: 'committed'; hash: string; message: string; fileCount: number }
    | { state: 'hook-failure'; status: 'waking-agent' | 'retries-exhausted'; retryCount: number };

  interface Props {
    /** The status to display, or null/undefined if no auto-commit for this turn */
    status?: CommitStatus | null;
    workspaceId: string;
  }

  let { status = null, workspaceId }: Props = $props();

  function handleOpenCommitChangeset() {
    if (status?.state === 'committed') {
      appStore.dispatch(
        openWorkspaceCommitChangeset(workspaceId, status.hash, status.message),
      );
    }
  }
</script>

{#if status}
  <div class="w-full">
    <div
      class="w-full flex items-center gap-2 px-2 py-1.5 text-subtle rounded-lg min-w-0"
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">
        {#if status.state === 'committing'}
          <Fa icon={faSpinner} class="opacity-30 animate-spin" size="xs" />
          <span class="truncate min-w-0 text-left flex-1 text-subtle">
            {m.chat_autoCommitStatus_committing_label()}
          </span>
        {:else if status.state === 'committed'}
          <Fa icon={faCodeCommit} class="text-ghost" size="xs" />
          <span class="truncate min-w-0 text-left flex-1">
            {m.chat_autoCommitStatus_committed_label()}
            <button
              onclick={handleOpenCommitChangeset}
              class="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title={status.message}
            >
              {status.message}
            </button>
            <span class="text-subtle">
              {status.fileCount === 1
                ? m.chat_autoCommitStatus_fileCount_one({ count: formatInteger(status.fileCount) })
                : m.chat_autoCommitStatus_fileCount_many({
                    count: formatInteger(status.fileCount),
                  })}
            </span>
          </span>
        {:else if status.state === 'hook-failure'}
          <Fa icon={faCodeCommit} class="opacity-30 text-amber-500/70" size="xs" />
          <span class="truncate min-w-0 text-left flex-1">
            {#if status.status === 'waking-agent'}
              <span class="text-amber-500/70">{m.chat_autoCommitStatus_hooksFailed_label()}</span>
              <span class="text-subtle">
                {m.chat_autoCommitStatus_fixingAttempt_label({
                  attempt: formatInteger(status.retryCount),
                })}
              </span>
            {:else}
              <span class="text-red-500/70">{m.chat_autoCommitStatus_failed_label()}</span>
              <span class="text-subtle">
                {m.chat_autoCommitStatus_hooksFailedAfter_label({
                  count: formatInteger(status.retryCount),
                })}
              </span>
            {/if}
          </span>
        {/if}
      </div>
    </div>
  </div>
{/if}
