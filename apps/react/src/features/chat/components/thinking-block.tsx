// Source: src/lib/components/chat/ThinkingBlock.svelte.
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { MarkdownViewer, type MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { ShimmerOverlay } from '@/components/ui/shimmer-overlay';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import {
  extractReasoningHeading,
  extractStandaloneReasoningTitles,
} from '$lib/components/chat/reasoning-heading';
import { REASONING_SHIMMER_SECONDS } from '$lib/motion/shimmer-timing';
import { faBrain } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { ChatOperationalRow } from './chat-operational-row';
import './thinking-block.css';

export interface ThinkingBlockProps extends Pick<
  MarkdownViewerProps,
  'workspaceContext' | 'onOpenLink' | 'onOpenFile' | 'onOpenNote'
> {
  saved?: { expanded?: boolean; userToggled?: boolean; searchOwnsExpansion?: boolean };
  searchPath?: string;
  content: string;
  isStreaming?: boolean;
  /** Auto-expand while streaming, until manual or search ownership takes precedence. */
  autoExpandWhileStreaming?: boolean;
  workspaceId?: string;
  canOpenFile?: () => boolean;
  allowFileMedia?: boolean;
  class?: string;
  /** React alias; source class takes precedence, including an explicitly empty class. */
  className?: string;
  adjacentOperationalRow?: boolean;
}

export function ThinkingBlock({
  saved,
  searchPath,
  content,
  isStreaming = false,
  autoExpandWhileStreaming = true,
  workspaceId,
  canOpenFile,
  allowFileMedia = true,
  class: sourceClass,
  className = '',
  adjacentOperationalRow = false,
  workspaceContext,
  onOpenLink,
  onOpenFile,
  onOpenNote,
}: ThinkingBlockProps) {
  // Retained data seeds this disposable row once; replacing saved changes only future writes.
  const [disclosure, setDisclosure] = useState(() => ({
    expanded: saved?.expanded ?? false,
    userToggled: saved?.userToggled ?? false,
    searchOwnsExpansion: saved?.searchOwnsExpansion ?? false,
  }));
  // Native search events can arrive together before React commits their rendered snapshot.
  const currentDisclosure = useRef(disclosure);
  useLayoutEffect(() => {
    const current = currentDisclosure.current;
    if (current.userToggled || current.searchOwnsExpansion) return;
    const expanded = autoExpandWhileStreaming && isStreaming;
    if (current.expanded === expanded) return;
    const next = { ...current, expanded };
    currentDisclosure.current = next;
    // oxlint-disable-next-line react/set-state-in-effect -- Preserve the source streaming effect without writing automatic changes into saved.
    setDisclosure(next);
  }, [
    autoExpandWhileStreaming,
    isStreaming,
    disclosure.userToggled,
    disclosure.searchOwnsExpansion,
  ]);

  function toggle() {
    const next = {
      expanded: !currentDisclosure.current.expanded,
      userToggled: true,
      searchOwnsExpansion: false,
    };
    currentDisclosure.current = next;
    setDisclosure(next);
    if (saved) {
      // oxlint-disable-next-line react/immutability -- Source API writes retained UI state into the caller's current saved object.
      saved.expanded = next.expanded;
      saved.userToggled = true;
      saved.searchOwnsExpansion = false;
    }
  }

  function expandForSearch() {
    const current = currentDisclosure.current;
    if (current.expanded) return;
    const next = { ...current, expanded: true, searchOwnsExpansion: true };
    currentDisclosure.current = next;
    setDisclosure(next);
    if (saved) {
      // oxlint-disable-next-line react/immutability -- Search ownership is retained on the actual caller object across row eviction.
      saved.expanded = true;
      saved.searchOwnsExpansion = true;
    }
  }

  function restoreSearchExpansion() {
    const current = currentDisclosure.current;
    if (!current.searchOwnsExpansion) return;
    const next = {
      ...current,
      expanded: !current.userToggled && autoExpandWhileStreaming && isStreaming,
      searchOwnsExpansion: false,
    };
    currentDisclosure.current = next;
    setDisclosure(next);
    if (saved) {
      // oxlint-disable-next-line react/immutability -- Restore releases retained search ownership on the current caller object.
      saved.expanded = next.expanded;
      saved.searchOwnsExpansion = false;
    }
  }

  function handleDisclosureKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggle();
  }

  const reasoningContent = useMemo(
    () => extractReasoningHeading(content, { preserveInlineText: true }),
    [content],
  );
  const standaloneTitles = useMemo(() => extractStandaloneReasoningTitles(content), [content]);
  const instanceId = useId();
  const detailsId = `reasoning-details-${instanceId}`;
  const toggleLabel =
    reasoningContent.heading ??
    (isStreaming ? m.chat_thinkingBlock_thinking_label() : m.chat_thinkingBlock_reasoning_label());
  const rowClass = sourceClass ?? className;
  const leading = isStreaming ? (
    <IntentMarkLoader size={14} className="shrink-0" />
  ) : (
    <IconDefinitionIcon icon={faBrain} size={16} className={CHAT_OPERATIONAL_ICON_CLASS} />
  );

  function summaryText(label: string) {
    return (
      <span className="min-w-0 truncate whitespace-nowrap font-normal">
        {isStreaming ? (
          <ShimmerOverlay duration={REASONING_SHIMMER_SECONDS}>{label}</ShimmerOverlay>
        ) : (
          label
        )}
      </span>
    );
  }

  if (standaloneTitles) {
    return standaloneTitles.map((title, index) => (
      <ChatOperationalRow
        key={index}
        leading={leading}
        summary={summaryText(title)}
        ariaLabel={title}
        summaryTitle={title}
        adjacentOperationalRow={adjacentOperationalRow || index > 0}
        streaming={isStreaming}
        testId="reasoning-tool-call"
        summaryTestId="reasoning-summary"
        class={rowClass}
      />
    ));
  }

  return (
    <ChatOperationalRow
      leading={leading}
      summary={summaryText(toggleLabel)}
      showChevron={false}
      details={
        <div className="reasoning-expanded-body" data-reasoning-expanded-body="">
          <MarkdownViewer
            canOpenFile={canOpenFile}
            allowFileMedia={allowFileMedia}
            content={reasoningContent.body}
            isStreaming={isStreaming}
            workspaceId={workspaceId}
            workspaceContext={workspaceContext}
            onOpenLink={onOpenLink}
            onOpenFile={onOpenFile}
            onOpenNote={onOpenNote}
            taskBlockRenderMode="content"
          />
        </div>
      }
      animateDetailsHeight
      interactive
      searchDisclosureId={searchPath ? `thinking:${searchPath}` : undefined}
      onSearchExpand={expandForSearch}
      onSearchRestore={restoreSearchExpansion}
      expanded={disclosure.expanded}
      controls={detailsId}
      detailsId={detailsId}
      ariaLabel={toggleLabel}
      summaryTitle={toggleLabel}
      onclick={toggle}
      onkeydown={handleDisclosureKeydown}
      detailsClass={`${OPERATIONAL_EXPANDED_CONTENT_CLASS} pb-2 type-caption text-muted-foreground [&_.markdown-content]:text-sm [&_.markdown-content]:leading-relaxed [&_.markdown-content]:text-muted-foreground`}
      adjacentOperationalRow={adjacentOperationalRow}
      streaming={isStreaming}
      testId="reasoning-tool-call"
      disclosureTestId="reasoning-disclosure"
      summaryTestId="reasoning-summary"
      class={rowClass}
    />
  );
}

export default ThinkingBlock;
