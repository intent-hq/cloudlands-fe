<script lang="ts">
  import { faArrowRight, faPencil } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { SuggestedPrompt } from '$shared/types';
  import { crispOut, springIn } from '$lib/motion';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    COMPACT_TOOL_TRAILING_CLASS,
    OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
    OPERATIONAL_ROW_TONE_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    /** Array of suggested prompts to display */
    prompts: SuggestedPrompt[];
    /** Called when a suggestion is selected - sends immediately */
    onSelect: (prompt: string) => void;
    /** Called when a suggestion is edited - loads into input without sending */
    onEdit?: (prompt: string) => void;
    /** Tighten prompt rows when the containing chat panel is short. */
    compact?: boolean;
    /**
     * Whether to display the keyboard shortcut hints (⌃1 / Alt+1 etc.).
     * Hidden by default so the hints only appear on the focused chat when multiple
     * chats are visible at once — matches the shortcut's runtime gating.
     */
    showShortcutHints?: boolean;
  }

  let { prompts, onSelect, onEdit, compact = false, showShortcutHints = false }: Props = $props();

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  // Mac: Ctrl+number (⌥ produces special chars, ⌘ is tab switching)
  // Win/Linux: Alt+number (Ctrl is tab switching)
  const modifierSymbol = isMac ? '⌃' : 'Alt+';
  const SUGGESTED_PROMPT_HINT_CLASS = COMPACT_TOOL_TRAILING_CLASS.replace(
    'text-ui',
    'type-caption',
  );

  function handleClick(prompt: SuggestedPrompt) {
    onSelect(prompt);
  }

  function handleKeyDown(event: KeyboardEvent, prompt: SuggestedPrompt) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleClick(prompt);
  }

  // Only the first 3 prompts get keyboard shortcut hints
  function hasShortcutHint(index: number): boolean {
    return index < 3;
  }
</script>

{#if prompts.length > 0}
  <div
    class="mt-4 flex flex-col"
    data-testid="suggested-prompts-surface"
    in:springIn={{ tier: 'fast', y: 0, scale: 1 }}
    out:crispOut={{ tier: 'fast' }}
  >
    <div
      class="flex flex-col {compact ? 'gap-0' : 'gap-0.5'}"
      data-testid="suggested-prompts-list"
      data-compact={compact}
    >
      {#each prompts as prompt, index (`prompt-${index}`)}
        <div class="group relative flex min-w-0">
          <Button
            variant="ghost"
            class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} {OPERATIONAL_ROW_TONE_CLASS} flex h-auto w-full cursor-pointer items-center justify-start gap-[var(--operational-leading-gap)] rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-left hover:text-foreground focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring {onEdit
              ? 'pr-9'
              : ''}"
            data-typography-role="body"
            onclick={() => handleClick(prompt)}
            onkeydown={(event) => handleKeyDown(event, prompt)}
          >
            <span
              class="{CHAT_OPERATIONAL_LEADING_CLASS} mt-px self-start"
              data-suggested-prompt-icon
            >
              <Fa icon={faArrowRight} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
            </span>
            <span class="min-w-0 flex-1 text-pretty" data-suggested-prompt-label>{prompt}</span>
            {#if hasShortcutHint(index) && showShortcutHints}
              <Badge
                variant="secondary"
                class="{SUGGESTED_PROMPT_HINT_CLASS} h-5 !font-normal text-muted-foreground!"
                data-suggested-prompt-hint
              >
                {modifierSymbol}{index + 1}
              </Badge>
            {/if}
          </Button>
          {#if onEdit}
            <Tooltip side="top" delayDuration={300}>
              {#snippet trigger()}
                <Button
                  type="button"
                  variant="ghost-light"
                  size="icon-xs"
                  iconOnly
                  class="absolute right-0.5 top-1/2 shrink-0 -translate-y-1/2 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  onclick={(e) => {
                    e.stopPropagation();
                    onEdit(prompt);
                  }}
                  aria-label={m.chat_suggestedPrompts_editInInput_ariaLabel()}
                >
                  <Fa icon={faPencil} size="xs" />
                </Button>
              {/snippet}
              {#snippet content()}
                <span class="type-caption">{m.chat_suggestedPrompts_edit_tooltip()}</span>
              {/snippet}
            </Tooltip>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}
