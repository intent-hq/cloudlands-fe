<script lang="ts">
  /**
   * SkillsSection - Displays discovered agent skills in the sidebar
   *
   * Shows skills discovered from project and user directories.
   * Modeled after McpServersSection.svelte (collapsible, hidden when empty).
   */
  import { skillsStore, type SkillInfo } from '$features/agent/skills.store.svelte';
  import { slide } from 'svelte/transition';
  import { faChevronDown, faGlobe, faPuzzlePiece } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { navigateToFile } from '$lib/utils/workspace-navigation';

  interface Props {
    workspaceId: string;
    class?: string;
  }

  let { workspaceId, class: className }: Props = $props();

  // Collapse state - collapsed by default
  let isExpanded = $state(false);

  // Initialize store for this workspace
  $effect(() => {
    if (workspaceId) {
      skillsStore.setWorkspace(workspaceId);
    }
  });

  // Derived values from store — sorted with global skills first
  const skills = $derived(skillsStore.skills);
  const sortedSkills = $derived(
    [...skills].sort((a, b) => {
      const aIsGlobal = a.scope === 'user' || !a.scope;
      const bIsGlobal = b.scope === 'user' || !b.scope;
      if (aIsGlobal && !bIsGlobal) return -1;
      if (!aIsGlobal && bIsGlobal) return 1;
      return a.name.localeCompare(b.name);
    }),
  );
  function handleSkillClick(skill: SkillInfo) {
    if (skill.location) {
      navigateToFile(skill.location);
    }
  }
</script>

{#snippet skillRow(skill: SkillInfo)}
  {@const isGlobal = skill.scope === 'user' || !skill.scope}
  <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors group">
    <!-- Skill Icon + Name (clickable) -->
    <button
      type="button"
      class="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer text-left"
      onclick={() => handleSkillClick(skill)}
    >
      <div class="size-3.5 rounded flex items-center justify-center shrink-0">
        <Fa icon={isGlobal ? faGlobe : faPuzzlePiece} size="xs" class="text-muted-foreground opacity-70" />
      </div>
      <div class="flex-1 min-w-0">
        <span class="text-sm truncate block text-foreground">
          {skill.name}
        </span>
      </div>
    </button>
  </div>
{/snippet}

{#if skills.length > 0}
  <div class="mt-3 {className ?? ''}">
    <!-- Section Header -->
    <button
      type="button"
      class="w-full flex items-center gap-2 px-1.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      onclick={() => (isExpanded = !isExpanded)}
    >
      <Fa icon={faChevronDown} size="xs" class="opacity-50 transition-transform duration-200 {isExpanded ? '' : '-rotate-90'}" />
      <span>Skills</span>
      <span class="ml-auto text-ui opacity-60">{skills.length}</span>
    </button>

    {#if isExpanded}
      <div class="space-y-0.5 mt-1 pl-4" transition:slide={{ axis: 'y', duration: 200 }}>
        {#each sortedSkills as skill (skill.name)}
          {@render skillRow(skill)}
        {/each}
      </div>
    {/if}
  </div>
{/if}

