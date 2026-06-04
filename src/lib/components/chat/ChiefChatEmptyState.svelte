<script lang="ts">
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';

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
      label: 'Make workspaces for the latest PRs assigned to me.',
      prompt:
        'Make workspaces to tackle the latest PRs assigned to me, grouped by urgency with the right specialist for each workspace.',
    },
    {
      id: 'stale-workspaces',
      label: 'Delete stale workspaces.',
      prompt:
        'Analyze my workspaces for stale, duplicate, completed, or abandoned work. Propose which workspaces to archive or delete, explain why, and call out anything risky to preserve.',
    },
    {
      id: 'agent-performance',
      label: 'Analyze my workspaces to improve agent performance.',
      prompt:
        'Analyze recent workspaces and agent activity for ways to improve agent performance. Propose specialist changes, AGENTS.md updates, and codebase/tooling changes that would make future agents faster and more reliable.',
    },
    {
      id: 'morning-brief',
      label: 'Prepare my Chief of Staff brief for today.',
      prompt:
        'Give me a concise Chief of Staff brief for today: active workspaces, PRs/issues that need attention, blocked or waiting agents, and the highest-leverage next actions.',
    },
    {
      id: 'random-theme',
      label: 'Switch me to a random theme.',
      prompt:
        'Change my app settings by switching me to a random theme. Pick one that feels distinct from my current theme and apply it.',
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
      As your Chief of Staff, I can help you use the app, create and interact with workspaces,
      update your settings, and improve your specialists. Just ask!
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
        <Fa
          icon={faPaperPlane}
          class="mt-1.5 self-start opacity-50 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
          size="xs"
        />
        <span class="flex-1">{suggestion.label}</span>
      </div>
    {/each}
  </div>
</section>