// Source: src/lib/components/chat/SuggestedPrompts.svelte.
import { Fragment, useLayoutEffect, useMemo, useRef } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { ListView } from '@/components/patterns/collection';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  crispOut,
  springIn,
  usePresence,
  usePresenceTransition,
  type MotionTransitionConfig,
} from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  COMPACT_TOOL_TRAILING_CLASS,
  OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import {
  promptLinkRoutingUrl,
  promptVisibleText,
  splitPromptMarkdownLinks,
} from '$lib/components/chat/suggested-prompt-markdown-links';
import { faArrowRight, faPencil } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { SuggestedPrompt } from '$shared/types/suggested-prompt';

export interface SuggestedPromptsProps {
  /** Raw prompts; selecting or editing preserves their markdown. */
  prompts: SuggestedPrompt[];
  onSelect: (prompt: string) => void;
  onEdit?: (prompt: string) => void;
  compact?: boolean;
  /** Presentation only; the containing chat owns shortcut activation. */
  showShortcutHints?: boolean;
  workspaceId?: WorkspaceId;
  /** The host owns navigation, with the original native event from the anchor. */
  onOpenLink: (
    url: string,
    context: { workspaceId?: WorkspaceId; event: MouseEvent | KeyboardEvent },
  ) => void | Promise<void>;
}

const SUGGESTED_PROMPT_HINT_CLASS = COMPACT_TOOL_TRAILING_CLASS.replace('text-ui', 'type-caption');

function hasShortcutHint(index: number): boolean {
  return index < 3;
}

function surfaceTransition(node: HTMLElement): MotionTransitionConfig {
  const enter = springIn(node, { tier: 'fast', y: 0, scale: 1 });
  const exit = crispOut(node, { tier: 'fast' });
  return ({ direction } = {}) => (direction === 'out' ? exit : enter);
}

function PromptLink({
  url,
  label,
  workspaceId,
  onOpenLink,
}: Pick<SuggestedPromptsProps, 'workspaceId' | 'onOpenLink'> & {
  url: string;
  label: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Listen on the anchor itself so currentTarget, cancellation and modifiers stay native.
    const activate = (event: MouseEvent | KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void onOpenLink(url, { workspaceId, event });
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    };
    node.addEventListener('click', activate);
    node.addEventListener('keydown', keydown);
    return () => {
      node.removeEventListener('click', activate);
      node.removeEventListener('keydown', keydown);
    };
  }, [url, workspaceId, onOpenLink]);

  return (
    <a
      ref={ref}
      href={url}
      title={url}
      className="cursor-pointer underline underline-offset-2 hover:opacity-80"
      data-suggested-prompt-link=""
    >
      {label}
    </a>
  );
}

function PromptSurface({
  prompts,
  onSelect,
  onEdit,
  compact = false,
  showShortcutHints = false,
  workspaceId,
  onOpenLink,
  present,
  onExit,
}: SuggestedPromptsProps & { present: boolean; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, surfaceTransition);
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  const modifierSymbol = isMac ? '⌃' : 'Alt+';

  return (
    <div
      ref={ref}
      className="flex flex-col"
      data-testid="suggested-prompts-surface"
      inert={!present}
    >
      <ListView
        items={prompts}
        virtualize={false}
        onActivate={(prompt) => onSelect(prompt)}
        className={cn(
          'overflow-visible! [&>div>div:last-child]:flex [&>div>div:last-child]:flex-col',
          compact ? '[&>div>div:last-child]:gap-0' : '[&>div>div:last-child]:gap-0.5',
        )}
        data-testid="suggested-prompts-list"
        data-compact={compact}
        row={({ item: prompt, index }) => {
          const parts = splitPromptMarkdownLinks(prompt);
          const leadingText = parts[0]?.type === 'text' ? parts[0].content : '';
          return (
            <div
              role="presentation"
              className={`${OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} ${OPERATIONAL_ROW_TONE_CLASS} group relative flex cursor-pointer items-center gap-[var(--operational-leading-gap)] rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-left opacity-100 pr-9 transition-colors hover:text-foreground has-[[data-suggested-prompt-text]:focus-visible]:outline-2 has-[[data-suggested-prompt-text]:focus-visible]:outline-offset-2 has-[[data-suggested-prompt-text]:focus-visible]:outline-ring`}
              data-typography-role="body"
              data-suggested-prompt-row=""
            >
              <span
                className={`${CHAT_OPERATIONAL_LEADING_CLASS} mt-px self-start`}
                data-suggested-prompt-icon=""
              >
                <IconDefinitionIcon
                  icon={faArrowRight}
                  size={16}
                  className={CHAT_OPERATIONAL_ICON_CLASS}
                />
              </span>
              <span className="min-w-0 flex-1 text-pretty" data-suggested-prompt-label="">
                <span
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source inline send span and sibling semantic anchors; a button wrapper would hide those links from accessibility.
                  role="button"
                  tabIndex={0}
                  aria-label={promptVisibleText(prompt)}
                  className="focus-visible:outline-none"
                  data-suggested-prompt-text=""
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(prompt);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelect(prompt);
                  }}
                >
                  {leadingText}
                </span>
                {parts
                  .slice(leadingText ? 1 : 0)
                  .map((part, partIndex) =>
                    part.type === 'link' ? (
                      <PromptLink
                        key={partIndex}
                        url={promptLinkRoutingUrl(part.url)}
                        label={part.label}
                        workspaceId={workspaceId}
                        onOpenLink={onOpenLink}
                      />
                    ) : (
                      <Fragment key={partIndex}>{part.content}</Fragment>
                    ),
                  )}
              </span>
              {hasShortcutHint(index) && showShortcutHints && (
                <kbd
                  className={`${SUGGESTED_PROMPT_HINT_CLASS} mt-px inline-flex h-5 items-center self-start border-0 bg-transparent p-0 font-sans font-normal text-muted-foreground! opacity-100`}
                  data-suggested-prompt-hint=""
                >
                  {modifierSymbol}
                  {index + 1}
                </kbd>
              )}
              {onEdit && (
                <Tooltip
                  side="top"
                  delayDuration={300}
                  content={
                    <span className="type-caption">{m.chat_suggestedPrompts_edit_tooltip()}</span>
                  }
                >
                  <Button
                    type="button"
                    variant="ghost-light"
                    size="icon-xs"
                    iconOnly
                    className="absolute right-0.5 top-[calc(var(--operational-leading-half-slot-size)+var(--space-1)*0.5+1px)] shrink-0 -translate-y-1/2 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(prompt);
                    }}
                    aria-label={m.chat_suggestedPrompts_editInInput_ariaLabel()}
                  >
                    <IconDefinitionIcon icon={faPencil} size="0.75em" />
                  </Button>
                </Tooltip>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

export function SuggestedPrompts({ prompts, ...props }: SuggestedPromptsProps) {
  const surfaces = useMemo(() => (prompts.length > 0 ? [prompts] : []), [prompts]);
  const presence = usePresence(surfaces, () => 'prompts');
  return presence.entries.map(({ key, value, present }) => (
    <PromptSurface
      key={key}
      {...props}
      prompts={value}
      present={present}
      onExit={() => presence.remove(key)}
    />
  ));
}

export default SuggestedPrompts;
