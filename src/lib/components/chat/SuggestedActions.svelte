<!--
  SuggestedActions.svelte

  Shows clickable prompt suggestions when chat is empty.
  Helps users get started with common actions.
-->
<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Fa from 'svelte-fa';
  import {
    faCode,
    faLightbulb,
    faBug,
    faFileAlt,
    type IconDefinition,
  } from '@fortawesome/free-solid-svg-icons';

  interface Suggestion {
    id: string;
    label: string;
    prompt: string;
    icon: IconDefinition;
  }

  interface Props {
    onSelect?: (prompt: string) => void;
    class?: string;
    /** Custom suggestions - if not provided, defaults are used */
    suggestions?: Suggestion[];
  }

  let { onSelect, class: className = '', suggestions: customSuggestions }: Props = $props();

  // Default suggestions
  const defaultSuggestions: Suggestion[] = [
    {
      id: 'explain',
      label: 'Explain this codebase',
      prompt:
        'Give me a high-level overview of this codebase. What are the main components and how do they work together?',
      icon: faLightbulb,
    },
    {
      id: 'implement',
      label: 'Help me implement a feature',
      prompt:
        'I want to implement a new feature. Can you help me plan the approach and identify the files I need to modify?',
      icon: faCode,
    },
    {
      id: 'debug',
      label: 'Debug an issue',
      prompt: "I'm encountering a bug. Help me investigate and find the root cause.",
      icon: faBug,
    },
    {
      id: 'document',
      label: 'Write documentation',
      prompt: 'Help me write documentation for the current file or component.',
      icon: faFileAlt,
    },
  ];

  const suggestions = $derived(customSuggestions ?? defaultSuggestions);

  function handleSelect(suggestion: Suggestion) {
    onSelect?.(suggestion.prompt);
  }
</script>

<div class="flex flex-col gap-2 {className}">
  {#each suggestions as suggestion, index (`suggestion-${index}-${suggestion.label}`)}
    <button
      type="button"
      class="group flex items-center gap-3 py-2.5 px-3.5 rounded-lg border border-border bg-transparent cursor-pointer transition-all duration-150 text-left hover:bg-muted active:scale-[0.98]"
      onclick={() => handleSelect(suggestion)}
      in:fly={{ y: 10, duration: 300, delay: index * 50, easing: cubicOut }}
    >
      <div
        class="flex items-center justify-center w-7 h-7 rounded-md bg-muted text-muted-foreground transition-all duration-150 group-hover:bg-primary group-hover:text-primary-foreground"
      >
        <Fa icon={suggestion.icon} class="w-3.5 h-3.5" />
      </div>
      <span class="text-xs font-medium text-foreground">{suggestion.label}</span>
    </button>
  {/each}
</div>
