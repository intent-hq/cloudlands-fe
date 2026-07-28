<script lang="ts">
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  type ChiefSuggestion = {
    id: string;
    label: string;
    prompt: string;
  };

  interface Props {
    onSelect: (prompt: string) => void;
  }

  let { onSelect }: Props = $props();

  const suggestions: ChiefSuggestion[] = [
    {
      id: 'assigned-prs',
      get label() {
        return m.chat_chiefEmptyState_assignedPrs_label();
      },
      get prompt() {
        return m.chat_chiefEmptyState_assignedPrs_prompt();
      },
    },
    {
      id: 'stale-workspaces',
      get label() {
        return m.chat_chiefEmptyState_staleWorkspaces_label();
      },
      get prompt() {
        return m.chat_chiefEmptyState_staleWorkspaces_prompt();
      },
    },
    {
      id: 'agent-performance',
      get label() {
        return m.chat_chiefEmptyState_agentPerformance_label();
      },
      get prompt() {
        return m.chat_chiefEmptyState_agentPerformance_prompt();
      },
    },
    {
      id: 'morning-brief',
      get label() {
        return m.chat_chiefEmptyState_morningBrief_label();
      },
      get prompt() {
        return m.chat_chiefEmptyState_morningBrief_prompt();
      },
    },
    {
      id: 'random-theme',
      get label() {
        return m.chat_chiefEmptyState_randomTheme_label();
      },
      get prompt() {
        return m.chat_chiefEmptyState_randomTheme_prompt();
      },
    },
  ];

  function handleKeyDown(event: KeyboardEvent, prompt: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(prompt);
    }
  }
</script>

<section class="mx-auto flex min-h-[46vh] w-full max-w-3xl flex-col justify-end pb-12 pt-16">
  <div class="mb-4 flex items-baseline gap-3 px-1.5 text-foreground">
    <p class="flex-1">
      {m.chat_chiefEmptyState_intro_label()}
    </p>
  </div>

  <div class="flex flex-col gap-px" transition:slide={{ axis: 'y', duration: 150 }}>
    {#each suggestions as suggestion (suggestion.id)}
      <div
        role="button"
        tabindex="0"
        class="group flex cursor-pointer items-baseline gap-3 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-left text-muted-foreground transition-all duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
        onclick={() => onSelect(suggestion.prompt)}
        onkeydown={(event) => handleKeyDown(event, suggestion.prompt)}
      >
        <span
          aria-hidden="true"
          class="mt-1.5 flex w-3 shrink-0 justify-center self-start opacity-70 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
          data-testid="chief-suggestion-icon"
        >
          <Fa icon={faPaperPlane} size="xs" />
        </span>
        <span class="flex-1">{suggestion.label}</span>
      </div>
    {/each}
  </div>
</section>