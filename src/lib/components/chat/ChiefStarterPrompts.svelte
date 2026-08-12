<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import SuggestedPrompts from './SuggestedPrompts.svelte';

  interface Props {
    onSelect: (prompt: string) => void;
    compact?: boolean;
  }

  let { onSelect, compact = false }: Props = $props();

  const suggestions = $derived([
    {
      label: m.chat_chiefEmptyState_assignedPrs_label(),
      prompt: m.chat_chiefEmptyState_assignedPrs_prompt(),
    },
    {
      label: m.chat_chiefEmptyState_staleWorkspaces_label(),
      prompt: m.chat_chiefEmptyState_staleWorkspaces_prompt(),
    },
    {
      label: m.chat_chiefEmptyState_agentPerformance_label(),
      prompt: m.chat_chiefEmptyState_agentPerformance_prompt(),
    },
    {
      label: m.chat_chiefEmptyState_morningBrief_label(),
      prompt: m.chat_chiefEmptyState_morningBrief_prompt(),
    },
    {
      label: m.chat_chiefEmptyState_randomTheme_label(),
      prompt: m.chat_chiefEmptyState_randomTheme_prompt(),
    },
  ]);
  const labels = $derived(suggestions.map((suggestion) => suggestion.label));

  function handleSelect(label: string) {
    const suggestion = suggestions.find((item) => item.label === label);
    if (suggestion) onSelect(suggestion.prompt);
  }
</script>

<section class="pb-6 pt-6">
  <p class="type-body mb-5 max-w-[36rem] px-1.5 text-pretty text-muted-foreground">
    {m.chat_chiefEmptyState_intro_label()}
  </p>
  <SuggestedPrompts prompts={labels} onSelect={handleSelect} {compact} />
</section>
