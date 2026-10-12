// Source: src/lib/components/chat/ResponseGroup.svelte.
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { m } from '$shared/paraglide/messages.js';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import {
  faArrowsInLineVertical,
  faArrowsOutLineVertical,
} from '$lib/icons/phosphor-icon-definitions';
import {
  OPERATIONAL_GROUP_CONTENT_CLASS,
  CHAT_OPERATIONAL_ICON_CLASS,
  OPERATIONAL_PRIMARY_CLASS,
  OPERATIONAL_SECONDARY_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import { getOperationalGroupContentSpacingClass } from '$lib/components/chat/operational-cluster-projections';
import { getResponseGroupPreviewBlock } from '$lib/components/chat/response-group-blocks';
import { RESPONSE_GROUP_COLLAPSE_DELAY_MS } from '$lib/components/chat/response-group-timing';
import { ChatOperationalRow, type ChatOperationalRowProps } from './chat-operational-row';
import { safeDisclosureTransition } from './chat-motion';
import { CylinderScroller } from './cylinder-scroller';
import { InlineMarkdownSnippet } from './inline-markdown-snippet';
import './response-group.css';

export interface ResponseGroupProps {
  headerAdmitted?: boolean;
  headerHeight?: number;
  saved?: {
    expanded?: boolean;
    searchOwnsExpansion?: boolean;
    override?: 'automatic' | 'expanded-live' | 'expanded-completed' | 'collapsed';
  };
  name: string;
  isStreaming?: boolean;
  isTerminal?: boolean;
  /** True when the owning message is the conversation's final assistant message. */
  isLastConversationMessage?: boolean;
  /** React children replace the source's required zero-argument snippet. */
  children: ReactNode;
  blocks?: ContentBlock[];
  reasoningPhase?: boolean;
  adjacentOperationalRow?: boolean;
  searchPath?: string;
  class?: string;
  /** React alias; className wins when supplied, including an explicitly empty string. */
  className?: string;
}

type Branch = 'preview' | 'details';
const ChildLifetime = createContext<{
  branch: Branch | null;
  lifetime: number;
  isStreaming: boolean;
  children: ReactNode;
} | null>(null);

/** Retained outro shells must not revive a retired OperationalWindow attachment. */
function GroupBody({ branch }: { branch: Branch }) {
  const current = useContext(ChildLifetime)!;
  const [retained, setRetained] = useState(() => ({
    lifetime: current.lifetime,
    children: current.children,
    retired: false,
  }));
  let child = retained;
  if (current.branch === branch) {
    if (
      retained.lifetime !== current.lifetime ||
      retained.children !== current.children ||
      retained.retired
    ) {
      child = { lifetime: current.lifetime, children: current.children, retired: false };
      setRetained(child);
    }
  } else if (current.branch !== null && !retained.retired) {
    child = { ...retained, retired: true };
    setRetained(child);
  }
  // A lone outgoing branch retains its real content for intrinsic-height motion.
  // Once its sibling takes ownership it cannot remount children until re-entered.
  return (
    <CylinderScroller isActive={current.isStreaming} constrained={branch === 'preview'}>
      <div className="relative flex flex-col gap-0" data-response-group-content="">
        <span
          className="operational-group-guide intent-response-group-guide pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-border"
          data-operational-expanded-guide=""
          aria-hidden="true"
        />{' '}
        {!child.retired && <Fragment key={child.lifetime}>{child.children}</Fragment>}
      </div>
    </CylinderScroller>
  );
}

// Svelte's bidirectional directive supplies this direction to the canonical tick lifecycle.
function detailsTransition(node: Element) {
  return safeDisclosureTransition(node, {}, { direction: 'both' });
}

export function ResponseGroup({
  headerAdmitted = true,
  headerHeight = 28,
  saved,
  name,
  isStreaming = false,
  isTerminal = false,
  isLastConversationMessage = false,
  children,
  blocks,
  reasoningPhase = false,
  adjacentOperationalRow = false,
  searchPath,
  class: sourceClass,
  className,
}: ResponseGroupProps) {
  const hasPreview = (blocks?.length ?? 0) > 0;
  const [view, setView] = useState(() => ({
    isExpanded:
      saved?.expanded ??
      ((isStreaming && !hasPreview) || (!isStreaming && isTerminal && isLastConversationMessage)),
    isClosing: false,
    lifetime: 0,
  }));
  const current = useRef({
    ...view,
    isInitialized: false,
    desiredExpanded: false,
    prevStreaming: false,
    prevTerminal: false,
    searchOwnsExpansion: saved?.searchOwnsExpansion ?? false,
    disclosureOverride: saved?.override ?? 'automatic',
    collapseTimer: null as ReturnType<typeof setTimeout> | null,
  });
  // Retained data seeds once. Native callbacks, pending timers and teardown use current props.
  const props = useRef({ saved, isStreaming, isTerminal, isLastConversationMessage, hasPreview });
  useLayoutEffect(() => {
    props.current = { saved, isStreaming, isTerminal, isLastConversationMessage, hasPreview };
  }, [saved, isStreaming, isTerminal, isLastConversationMessage, hasPreview]);
  const contentEl = useRef<HTMLDivElement>(null);
  const triggerEl = useRef<HTMLButtonElement>(null);
  const instanceId = useId();
  const detailsId = `response-group-details-${instanceId}`;

  const save = useCallback(() => {
    const target = props.current.saved;
    if (target) {
      target.expanded = current.current.desiredExpanded;
      target.searchOwnsExpansion = current.current.searchOwnsExpansion;
      target.override = current.current.disclosureOverride;
    }
  }, []);

  const publish = useCallback(() => {
    const { isExpanded, isClosing, lifetime } = current.current;
    setView((previous) =>
      previous.isExpanded === isExpanded &&
      previous.isClosing === isClosing &&
      previous.lifetime === lifetime
        ? previous
        : { isExpanded, isClosing, lifetime },
    );
  }, []);

  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      const state = current.current;
      state.desiredExpanded = nextExpanded;
      save();
      if (nextExpanded) {
        state.isClosing = false;
        if (!state.isExpanded) state.lifetime += 1;
        state.isExpanded = true;
        publish();
        return;
      }
      if (!state.isExpanded) return;
      if (contentEl.current?.contains(document.activeElement))
        triggerEl.current?.focus({ preventScroll: true });
      state.isClosing = true;
      publish();
    },
    [publish, save],
  );

  // Commit inert/aria-hidden first, then remove the branch in a subsequent React commit.
  useLayoutEffect(() => {
    const state = current.current;
    if (!view.isClosing || !state.isClosing || !state.isExpanded) return;
    state.isExpanded = false;
    state.lifetime += 1;
    publish();
  }, [view.isClosing, publish]);

  const clearCollapseTimer = useCallback(() => {
    if (!current.current.collapseTimer) return;
    clearTimeout(current.current.collapseTimer);
    current.current.collapseTimer = null;
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearCollapseTimer();
    const state = current.current;
    if (state.disclosureOverride === 'collapsed' || !state.desiredExpanded) return;
    state.collapseTimer = setTimeout(() => {
      setExpanded(false);
      state.collapseTimer = null;
    }, RESPONSE_GROUP_COLLAPSE_DELAY_MS);
  }, [clearCollapseTimer, setExpanded]);

  // These are the source streaming-edge inputs. Last-message status is consulted only
  // for initial automatic expansion; saved replacement never re-seeds local ownership.
  const previousInputs = useRef<{
    isStreaming: boolean;
    isTerminal: boolean;
    hasPreview: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    const previous = previousInputs.current;
    if (
      previous?.isStreaming === isStreaming &&
      previous.isTerminal === isTerminal &&
      previous.hasPreview === hasPreview
    )
      return;
    previousInputs.current = { isStreaming, isTerminal, hasPreview };
    const state = current.current;
    if (!state.isInitialized) {
      state.isInitialized = true;
      state.desiredExpanded = state.isExpanded;
      state.prevStreaming = isStreaming;
      state.prevTerminal = isTerminal;
      if (state.searchOwnsExpansion) return;
      if (isStreaming && hasPreview && state.disclosureOverride === 'automatic') {
        setExpanded(false);
      } else if (!isStreaming && state.disclosureOverride === 'automatic') {
        setExpanded(isTerminal && props.current.isLastConversationMessage);
      }
      return;
    }

    if (isStreaming) {
      if (!state.prevStreaming) state.searchOwnsExpansion = false;
      if (!state.prevStreaming && state.disclosureOverride === 'expanded-completed') {
        state.disclosureOverride = 'automatic';
      }
      if (state.disclosureOverride === 'automatic') setExpanded(!hasPreview);
      clearCollapseTimer();
    } else if (state.prevStreaming && !isStreaming) {
      if (isTerminal) {
        clearCollapseTimer();
        if (state.disclosureOverride !== 'collapsed') setExpanded(true);
      } else {
        scheduleCollapse();
      }
    } else if (state.prevTerminal && !isTerminal) {
      scheduleCollapse();
    } else if (!state.prevTerminal && isTerminal) {
      clearCollapseTimer();
    } else if (
      !state.searchOwnsExpansion &&
      state.disclosureOverride !== 'expanded-completed' &&
      !isTerminal
    ) {
      setExpanded(false);
    }
    state.prevStreaming = isStreaming;
    state.prevTerminal = isTerminal;
  }, [isStreaming, isTerminal, hasPreview, setExpanded, clearCollapseTimer, scheduleCollapse]);

  useLayoutEffect(
    () => () => {
      clearCollapseTimer();
      save();
    },
    [clearCollapseTimer, save],
  );

  function toggle() {
    clearCollapseTimer();
    const state = current.current;
    state.searchOwnsExpansion = false;
    const nextExpanded = !state.desiredExpanded;
    state.disclosureOverride = nextExpanded
      ? isStreaming
        ? 'expanded-live'
        : 'expanded-completed'
      : 'collapsed';
    setExpanded(nextExpanded);
  }

  function expandForSearch() {
    if (current.current.desiredExpanded) return;
    clearCollapseTimer();
    current.current.searchOwnsExpansion = true;
    setExpanded(true);
  }

  function restoreSearchExpansion() {
    const state = current.current;
    if (!state.searchOwnsExpansion) return;
    state.searchOwnsExpansion = false;
    if (isStreaming && state.disclosureOverride === 'automatic') {
      setExpanded(!hasPreview);
      return;
    }
    setExpanded(false);
  }

  const previewBlock = reasoningPhase ? undefined : getResponseGroupPreviewBlock(blocks);
  const textSnippet = previewBlock ? getContentBlockText(previewBlock).trim() : '';
  const displayName = reasoningPhase
    ? name.trim() ||
      (isStreaming ? m.chat_thinkingBlock_thinking_label() : m.chat_thinkingBlock_reasoning_label())
    : name;
  const accessibleSummary = textSnippet ? `${displayName}: ${textSnippet}` : displayName;
  const groupContentClass = `${OPERATIONAL_GROUP_CONTENT_CLASS} ${getOperationalGroupContentSpacingClass(blocks)}`;
  const rowClass = className ?? sourceClass ?? '';
  const previewTransition: NonNullable<ChatOperationalRowProps['previewTransition']> = (
    node,
    params = {},
    options = {},
  ) => {
    if (
      view.isExpanded ||
      (!isStreaming && isTerminal && current.current.disclosureOverride !== 'collapsed')
    ) {
      return { duration: 0 };
    }
    return safeDisclosureTransition(node, params, options);
  };

  const childLifetime = useMemo(
    () => ({
      branch: view.isExpanded
        ? ('details' as const)
        : isStreaming && hasPreview
          ? ('preview' as const)
          : null,
      lifetime: view.lifetime,
      isStreaming,
      children,
    }),
    [view.isExpanded, view.lifetime, isStreaming, hasPreview, children],
  );

  return (
    <ChildLifetime value={childLifetime}>
      <ChatOperationalRow
        headerAdmitted={headerAdmitted}
        headerHeight={headerHeight}
        leading={
          <span className="flex" data-response-group-disclosure-icon="">
            <IconDefinitionIcon
              icon={view.isExpanded ? faArrowsOutLineVertical : faArrowsInLineVertical}
              size={16}
              className={CHAT_OPERATIONAL_ICON_CLASS}
            />
          </span>
        }
        summary={
          <>
            <span
              className={`font-normal ${OPERATIONAL_PRIMARY_CLASS}`}
              data-testid="response-group-name"
            >
              {displayName}
            </span>
            {textSnippet && !view.isExpanded && (!isStreaming || !hasPreview) ? (
              <InlineMarkdownSnippet
                content={textSnippet}
                className={`ml-2.5 font-normal ${OPERATIONAL_SECONDARY_CLASS}`}
                testId="response-group-snippet"
              />
            ) : null}
          </>
        }
        preview={
          !view.isExpanded && isStreaming && hasPreview ? <GroupBody branch="preview" /> : undefined
        }
        details={view.isExpanded ? <GroupBody branch="details" /> : undefined}
        interactive
        showChevron={false}
        expanded={view.isExpanded}
        controls={detailsId}
        ariaLabel={accessibleSummary}
        title={accessibleSummary}
        summaryTitle={accessibleSummary}
        onclick={toggle}
        detailsId={detailsId}
        previewClass={`${OPERATIONAL_GROUP_CONTENT_CLASS} pt-[var(--space-2)]`}
        detailsClass={groupContentClass}
        previewTransition={previewTransition}
        detailsTransition={detailsTransition}
        detailsMotion="height-opacity-y"
        detailsInert={view.isClosing}
        detailsAriaHidden={view.isClosing || undefined}
        triggerElement={triggerEl}
        detailsElement={contentEl}
        adjacentOperationalRow={adjacentOperationalRow}
        streaming={isStreaming}
        testId="response-group"
        disclosureTestId="response-group-disclosure"
        summaryTestId="response-group-summary"
        class={view.isExpanded ? `${rowClass} mb-3` : rowClass}
        searchDisclosureId={searchPath ? `group:${searchPath}` : undefined}
        summarySearchPath={searchPath ? `${searchPath}:summary` : undefined}
        onSearchExpand={expandForSearch}
        onSearchRestore={restoreSearchExpansion}
      />
    </ChildLifetime>
  );
}

export default ResponseGroup;
