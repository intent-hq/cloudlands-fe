<script lang="ts">
  import { faArrowRight, faPencil } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { SuggestedPrompt } from '$shared/types';
  import { crispOut, springIn } from '$lib/motion';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { ListView } from '$lib/components/patterns/collection';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import { handleLink } from '$features/navigation/link-handler';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    COMPACT_TOOL_TRAILING_CLASS,
    OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
    OPERATIONAL_ROW_TONE_CLASS,
  } from './operational-disclosure-row';
  import {
    promptLinkRoutingUrl,
    promptVisibleText,
    splitPromptMarkdownLinks,
  } from './suggested-prompt-markdown-links';

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
    /** Workspace the prompts belong to; routes markdown-link clicks like chat links. */
    workspaceId?: WorkspaceId;
  }

  let {
    prompts,
    onSelect,
    onEdit,
    compact = false,
    showShortcutHints = false,
    workspaceId,
  }: Props = $props();

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

  // Markdown links inside a prompt open like chat links instead of selecting the row.
  function handleLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    event.stopPropagation();
    void handleLink(url, { workspaceId, event });
  }

  function handleLinkKeyDown(event: KeyboardEvent, url: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      void handleLink(url, { workspaceId, event });
    }
  }

  // Only the first 3 prompts get keyboard shortcut hints
  function hasShortcutHint(index: number): boolean {
    return index < 3;
  }
</script>

{#if prompts.length > 0}
  <div
    class="flex flex-col"
    data-testid="suggested-prompts-surface"
    in:springIn={{ tier: 'fast', y: 0, scale: 1 }}
    out:crispOut={{ tier: 'fast' }}
  >
    <ListView
      items={prompts}
      virtualize={false}
      onActivate={handleClick}
      class="overflow-visible! [&>div>div:last-child]:flex [&>div>div:last-child]:flex-col {compact
        ? '[&>div>div:last-child]:gap-0'
        : '[&>div>div:last-child]:gap-0.5'}"
      data-testid="suggested-prompts-list"
      data-compact={compact}
    >
      {#snippet row({ item: prompt, index })}
        {@const parts = splitPromptMarkdownLinks(prompt)}
        {@const leadingText = parts[0]?.type === 'text' ? parts[0].content : ''}
        <!-- The row is a presentational mouse target; the send control is the text span so
             the anchors are not presentational descendants of a button (ARIA). -->
        <div
          role="presentation"
          class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} {OPERATIONAL_ROW_TONE_CLASS} group relative flex cursor-pointer items-center gap-[var(--operational-leading-gap)] rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-left opacity-100 pr-9 transition-colors hover:text-foreground has-[[data-suggested-prompt-text]:focus-visible]:outline-2 has-[[data-suggested-prompt-text]:focus-visible]:outline-offset-2 has-[[data-suggested-prompt-text]:focus-visible]:outline-ring"
          data-typography-role="body"
          data-suggested-prompt-row
        >
          <span
            class="{CHAT_OPERATIONAL_LEADING_CLASS} mt-px self-start"
            data-suggested-prompt-icon
          >
            <Fa icon={faArrowRight} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
          </span>
          <span class="min-w-0 flex-1 text-pretty" data-suggested-prompt-label
            ><span
              role="button"
              tabindex="0"
              aria-label={promptVisibleText(prompt)}
              class="focus-visible:outline-none"
              data-suggested-prompt-text
              onclick={(event) => {
                event.stopPropagation();
                handleClick(prompt);
              }}
              onkeydown={(e) => handleKeyDown(e, prompt)}>{leadingText}</span
            >{#each parts.slice(leadingText ? 1 : 0) as part, partIndex (partIndex)}{#if part.type === 'link'}{@const url =
                  promptLinkRoutingUrl(part.url)}<a
                  href={url}
                  title={url}
                  class="cursor-pointer underline underline-offset-2 hover:opacity-80"
                  data-suggested-prompt-link
                  onclick={(e) => handleLinkClick(e, url)}
                  onkeydown={(e) => handleLinkKeyDown(e, url)}>{part.label}</a
                >{:else}{part.content}{/if}{/each}</span
          >
          {#if hasShortcutHint(index) && showShortcutHints}
            <kbd
              class="{SUGGESTED_PROMPT_HINT_CLASS} mt-px inline-flex h-5 items-center self-start border-0 bg-transparent p-0 font-sans font-normal text-muted-foreground! opacity-100"
              data-suggested-prompt-hint
            >
              {modifierSymbol}{index + 1}
            </kbd>
          {/if}
          {#if onEdit}
            <Tooltip side="top" delayDuration={300}>
              {#snippet trigger()}
                <!-- Center on py-0.5 + mt-px + half the leading slot, not the full row. -->
                <Button
                  type="button"
                  variant="ghost-light"
                  size="icon-xs"
                  iconOnly
                  class="absolute right-0.5 top-[calc(var(--operational-leading-half-slot-size)+var(--space-1)*0.5+1px)] shrink-0 -translate-y-1/2 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
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
      {/snippet}
    </ListView>
  </div>
{/if}
