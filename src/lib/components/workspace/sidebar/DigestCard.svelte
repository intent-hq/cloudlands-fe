<script lang="ts">
  import type { Note } from '$shared/types';
  import type { TrackedChange } from '$features/file-tracking/types';
  import type { LocalCommitInfo } from '$features/accept-changes/types';
  import type { PRInfo } from '$lib/components/file-tracking/accept-changes/types';
  import { parseTaskStats } from './utils';
  import Fa from 'svelte-fa';
  import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import SpecTaskDonut from './SpecTaskDonut.svelte';

  interface Props {
    notes?: Note[];
    unstagedChanges?: TrackedChange[];
    stagedChanges?: TrackedChange[];
    commits?: LocalCommitInfo[];
    pullRequests?: PRInfo[];
    onOpenDashboard?: () => void;
  }

  let {
    notes = [],
    unstagedChanges = [],
    stagedChanges = [],
    commits = [],
    pullRequests = [],
    onOpenDashboard,
  }: Props = $props();

  // Get spec note and parse task stats (pass all notes to resolve linked task statuses)
  const specNote = $derived(notes.find((n) => n.id === 'spec' || n.isDefault));
  const taskStats = $derived(parseTaskStats(specNote?.content, notes));

  // Computed values
  const totalChanges = $derived(unstagedChanges.length + stagedChanges.length);
  const localCommits = $derived(commits.filter((c) => !c.isPushed));
  const hasPRs = $derived(pullRequests.length > 0);
</script>

<button
  type="button"
  class="w-full rounded-lg bg-muted/30 px-3 py-3 hover:bg-muted/50 transition-colors cursor-pointer text-left whitespace-nowrap"
  onclick={() => onOpenDashboard?.()}
>
  <div class="flex items-center gap-2 text-xs">
    <SpecTaskDonut {taskStats} />

    <!-- Status indicator -->
    <div class="flex items-center gap-2 ml-auto text-muted-foreground mr-1">
      {#if hasPRs}
        {@const pr = pullRequests[0]}
        <Fa icon={faCodePullRequest} size="xs" />
        <span>PR #{pr.number}</span>
      {:else if totalChanges > 0}
        <span>{totalChanges} local change{totalChanges === 1 ? '' : 's'}</span>
      {:else if localCommits.length > 0}
        <span>{localCommits.length} to push</span>
      {:else}
        <span>No changes</span>
      {/if}
    </div>
  </div>
</button>
