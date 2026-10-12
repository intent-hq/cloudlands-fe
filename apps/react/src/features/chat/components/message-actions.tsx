// Source: src/lib/components/chat/MessageActions.svelte.
import * as React from 'react';
import type { IconProps } from '@phosphor-icons/react';
import { ActionBar, defineActions } from '@/components/patterns/action-menu';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { observeMessageActionDay } from '$lib/components/chat/message-action-day-clock';
import { queueMessageControls } from '$lib/components/chat/message-controls-mount-queue';
import { observeLazyTurnVisibility } from '$lib/components/chat/lazy-turn-observer';
import {
  MESSAGE_ACTION_REVEAL_CLASS,
  MESSAGE_ACTION_SURFACE_CLASS,
  MESSAGE_ACTION_TIME_CLASS,
  resolveMessageActionDate,
} from '$lib/components/chat/message-action-surface';
import { formatDateTime, formatFullDateTime, formatTime, type DateInput } from '$lib/i18n/format';
import type { IconDefinition } from '$lib/icons/icon-definition';
import {
  faArrowRotateRight,
  faArrowUp,
  faCodeBranch,
  faCopy,
  faPencil,
  faThumbsDown,
  faThumbsUp,
} from '$lib/icons/phosphor-icon-definitions';
import type { QueueInfo } from '$lib/utils/queue-info';
import { m } from '$shared/paraglide/messages.js';
import { QueuedMessageNoticeHeader } from './queued-message-notice-header';

type MessageRole = 'user' | 'assistant';

export interface MessageActionsProps {
  role: MessageRole;
  onCopy?: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
  /** Fork the conversation from this message. */
  onFork?: () => void;
  onVote?: (vote: 'up' | 'down') => void;
  currentVote?: 'up' | 'down' | null;
  showOnHover?: boolean;
  class?: string;
  /** React alias; when supplied, takes precedence over class, including an empty string. */
  className?: string;
  /** Session ID for this message (used for debugging). */
  requestId?: string;
  /** Called when user wants to scroll to previous user message. */
  onScrollToPrevious?: () => void;
  previousMessageLoading?: boolean;
  /** Canonical message time. */
  timestamp?: DateInput | null;
  /** Legacy fallback when the canonical timestamp is absent or invalid. */
  createdAt?: DateInput | null;
  /** Delivery metadata, presented only with the user message's hover/focus actions. */
  queueInfo?: QueueInfo | null;
}

// ActionBar accepts component icons. Bind the canonical definitions to the shared
// adapter; inline icons retain the source Fa size="xs", overflow supplies size=16.
function actionIcon(icon: IconDefinition) {
  return React.memo(function MessageActionIcon({
    size = '0.75em',
    className,
    style,
    weight,
  }: IconProps) {
    return (
      <IconDefinitionIcon
        icon={icon}
        size={size}
        className={className}
        style={style}
        weight={weight}
      />
    );
  });
}

const EditIcon = actionIcon(faPencil);
const RegenerateIcon = actionIcon(faArrowRotateRight);
const PreviousIcon = actionIcon(faArrowUp);
const ForkIcon = actionIcon(faCodeBranch);
const VoteUpIcon = actionIcon(faThumbsUp);
const VoteDownIcon = actionIcon(faThumbsDown);
const CopyIcon = actionIcon(faCopy);

export function MessageActions({
  role,
  onCopy,
  onEdit,
  onRegenerate,
  onFork,
  onVote,
  currentVote = null,
  showOnHover = true,
  class: sourceClass = '',
  className,
  requestId,
  onScrollToPrevious,
  previousMessageLoading = false,
  timestamp,
  createdAt,
  queueInfo,
}: MessageActionsProps) {
  const actionSurface = React.useRef<HTMLDivElement>(null);
  const [controlsReady, setControlsReady] = React.useState(false);
  const [containerWidth, setContainerWidth] = React.useState(Number.POSITIVE_INFINITY);
  const [today, setToday] = React.useState(() => new Date().toDateString());

  React.useEffect(() => {
    const surface = actionSurface.current;
    if (!surface) return;
    const root = surface.closest<HTMLElement>('[data-message-controls-root]');
    const parent = surface.parentElement;
    if (!root || !parent) {
      setControlsReady(true);
      return;
    }
    let stopObserving = () => {};
    let released = false;
    const release = () => {
      // Both queued mounting and teardown release this registration.
      if (released) return;
      released = true;
      stopObserving();
      parent.removeEventListener('pointerenter', queued.mountNow);
      parent.removeEventListener('focusin', queued.mountNow);
    };
    const queued = queueMessageControls(() => {
      setControlsReady(true);
      release();
    });
    stopObserving = observeLazyTurnVisibility(surface, root, (_intersecting, visible) => {
      if (visible) queued.prioritize();
    });
    parent.addEventListener('pointerenter', queued.mountNow);
    parent.addEventListener('focusin', queued.mountNow);
    return () => {
      queued.cancel();
      release();
    };
  }, []);

  React.useEffect(() => {
    if (!controlsReady) return;
    const parent = actionSurface.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [controlsReady]);

  React.useEffect(() => observeMessageActionDay(setToday), []);

  const actionDate = resolveMessageActionDate(timestamp, createdAt);
  const showDate = actionDate !== null && actionDate.toDateString() !== today;
  const compactTime = actionDate
    ? showDate
      ? formatDateTime(actionDate)
      : formatTime(actionDate)
    : '';
  const fullTime = actionDate ? formatFullDateTime(actionDate) : '';
  const interactiveClass = showOnHover
    ? 'group-hover:pointer-events-auto group-focus-within:pointer-events-auto'
    : 'pointer-events-auto';
  // Keep a full date beside the primary action; the existing menu keeps the rest reachable.
  const visibleActionCount =
    role === 'assistant' && showDate && containerWidth < 320 ? 1 : Number.POSITIVE_INFINITY;
  const actions = defineActions([
    {
      id: 'edit',
      label: m.chat_messageActions_editMessage_ariaLabel(),
      icon: EditIcon,
      shortcut: 'e',
      when: role === 'user' && Boolean(onEdit),
    },
    {
      id: 'regenerate',
      label: m.chat_messageActions_regenerate_ariaLabel(),
      icon: RegenerateIcon,
      when: role === 'assistant' && Boolean(onRegenerate),
    },
    {
      id: 'scroll-previous',
      label: previousMessageLoading
        ? m.chat_messageActions_previousMessageLoading_label()
        : m.chat_messageActions_previousUserMessage_label(),
      disabled: previousMessageLoading,
      icon: PreviousIcon,
      when: role === 'assistant' && Boolean(onScrollToPrevious),
    },
    {
      id: 'fork',
      label: m.chat_messageActions_fork_ariaLabel(),
      icon: ForkIcon,
      when: role === 'assistant' && Boolean(onFork),
    },
    {
      id: 'vote-up',
      kind: 'checkbox',
      label: m.chat_messageActions_goodResponse_label(),
      icon: VoteUpIcon,
      checked: currentVote === 'up',
      when: role === 'assistant' && Boolean(onVote),
    },
    {
      id: 'vote-down',
      kind: 'checkbox',
      label: m.chat_messageActions_badResponse_label(),
      icon: VoteDownIcon,
      checked: currentVote === 'down',
      when: role === 'assistant' && Boolean(onVote),
    },
    {
      id: 'copy',
      label: m.chat_messageActions_copyMessage_ariaLabel(),
      icon: CopyIcon,
      when: Boolean(onCopy),
    },
    {
      id: 'scroll-previous',
      label: previousMessageLoading
        ? m.chat_messageActions_previousMessageLoading_label()
        : m.chat_messageActions_scrollToPrevious_label(),
      disabled: previousMessageLoading,
      icon: PreviousIcon,
      when: role === 'user' && Boolean(onScrollToPrevious),
    },
  ]);

  async function handleCopy(event: Event) {
    if ('shiftKey' in event && event.shiftKey && requestId) {
      await navigator.clipboard.writeText(requestId);
    } else {
      onCopy?.();
    }
  }

  function handleAction(id: string, event: Event) {
    switch (id) {
      case 'edit':
        onEdit?.();
        break;
      case 'regenerate':
        onRegenerate?.();
        break;
      case 'fork':
        onFork?.();
        break;
      case 'vote-up':
        onVote?.('up');
        break;
      case 'vote-down':
        onVote?.('down');
        break;
      case 'copy':
        void handleCopy(event);
        break;
      case 'scroll-previous':
        onScrollToPrevious?.();
        break;
    }
  }

  return (
    <div
      ref={actionSurface}
      data-testid="message-actions"
      data-message-actions-role={role}
      style={{ maxWidth: 'calc(100% - 0.5rem)' }}
      className={`${MESSAGE_ACTION_SURFACE_CLASS} ${showOnHover ? MESSAGE_ACTION_REVEAL_CLASS : ''} ${className ?? sourceClass}`}
    >
      {actionDate && compactTime && fullTime && (
        <time
          className={MESSAGE_ACTION_TIME_CLASS}
          dateTime={actionDate.toISOString()}
          title={fullTime}
          aria-label={fullTime}
        >
          {compactTime}
        </time>
      )}
      {controlsReady && (
        <>
          {role === 'user' && queueInfo && (
            <div className={`min-w-0 ${interactiveClass}`}>
              <QueuedMessageNoticeHeader queueInfo={queueInfo} />
            </div>
          )}
          <ActionBar
            actions={actions}
            visibleCount={visibleActionCount}
            className={`shrink-0 ${interactiveClass}`}
            overflowLabel={m.lib_commandPalette_quickActions_ariaLabel()}
            onAction={handleAction}
          />
        </>
      )}
    </div>
  );
}

export default MessageActions;
