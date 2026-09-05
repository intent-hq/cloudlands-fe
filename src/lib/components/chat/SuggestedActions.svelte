<!--
  SuggestedActions.svelte

  Shows clickable prompt suggestions when chat is empty.
  Helps users get started with common actions.
-->
<script lang="ts">
  import { crispOut, spring, springIn } from '$lib/motion';
  import Fa from 'svelte-fa';
  import {
    faCode,
    faLightbulb,
    faBug,
    faFileAlt,
    type IconDefinition,
  } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';

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
  const defaultSuggestions: Suggestion[] = $derived([
    {
      id: 'explain',
      label: m.chat_suggestedActions_explain_label(),
      prompt: m.chat_suggestedActions_explain_prompt(),
      icon: faLightbulb,
    },
    {
      id: 'implement',
      label: m.chat_suggestedActions_implement_label(),
      prompt: m.chat_suggestedActions_implement_prompt(),
      icon: faCode,
    },
    {
      id: 'debug',
      label: m.chat_suggestedActions_debug_label(),
      prompt: m.chat_suggestedActions_debug_prompt(),
      icon: faBug,
    },
    {
      id: 'document',
      label: m.chat_suggestedActions_document_label(),
      prompt: m.chat_suggestedActions_document_prompt(),
      icon: faFileAlt,
    },
  ]);

  const suggestions = $derived(customSuggestions ?? defaultSuggestions);

  function handleSelect(suggestion: Suggestion) {
    onSelect?.(suggestion.prompt);
  }

  function suggestionIn(node: Element, { delay }: { delay: number }) {
    return { ...springIn(node, { tier: 'slow', y: 10, scale: 1 }), delay };
  }
</script>

<div class="flex flex-col gap-2 {className}">
  {#each suggestions as suggestion, index (`suggestion-${index}-${suggestion.label}`)}
    <div
      in:suggestionIn={{ delay: index * spring.fast.exit.duration }}
      out:crispOut={{ tier: 'fast' }}
    >
      <Button
        type="button"
        variant="outline"
        class="group flex w-full items-center gap-3 py-2.5 px-3.5 rounded-lg border border-border bg-transparent cursor-pointer transition-all duration-spring-fast ease-spring-fast motion-reduce:transition-none text-left hover:bg-muted active:scale-[0.98]"
        onclick={() => handleSelect(suggestion)}
      >
        <div
          class="flex items-center justify-center w-7 h-7 rounded-md bg-muted text-muted-foreground transition-all duration-spring-fast ease-spring-fast motion-reduce:transition-none group-hover:bg-primary group-hover:text-primary-foreground"
        >
          <Fa icon={suggestion.icon} class="w-3.5 h-3.5" />
        </div>
        <span class="text-xs font-medium text-foreground">{suggestion.label}</span>
      </Button>
    </div>
  {/each}
</div>
