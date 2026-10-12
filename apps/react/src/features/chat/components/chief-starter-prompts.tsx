// Source: src/lib/components/chat/ChiefStarterPrompts.svelte.
import { m } from '$shared/paraglide/messages.js';
import { SuggestedPrompts, type SuggestedPromptsProps } from './suggested-prompts';

export interface ChiefStarterPromptsProps {
  onSelect: (prompt: string) => void;
  compact?: boolean;
  onOpenLink: SuggestedPromptsProps['onOpenLink'];
}

export function ChiefStarterPrompts({
  onSelect,
  compact = false,
  onOpenLink,
}: ChiefStarterPromptsProps) {
  const suggestions = [
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
  ];
  const labels = suggestions.map((suggestion) => suggestion.label);

  function handleSelect(label: string) {
    const suggestion = suggestions.find((item) => item.label === label);
    if (suggestion) onSelect(suggestion.prompt);
  }

  return (
    <section className="pb-6 pt-6">
      <p className="type-body mb-5 max-w-[36rem] px-1.5 text-pretty text-muted-foreground">
        {m.chat_chiefEmptyState_intro_label()}
      </p>
      <SuggestedPrompts
        prompts={labels}
        onSelect={handleSelect}
        compact={compact}
        onOpenLink={onOpenLink}
      />
    </section>
  );
}

export default ChiefStarterPrompts;
