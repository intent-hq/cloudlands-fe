// Source: src/lib/components/chat/ChatOperationalRow.svelte.
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { CaretDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  useAnimatedHeight,
  usePresence,
  usePresenceTransition,
  type MotionTransitionConfig,
  type SpringTierName,
} from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  CHAT_OPERATIONAL_CHEVRON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_CONTAINER_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
  CHAT_OPERATIONAL_TRAILING_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';
import { searchDisclosureEvents } from '$lib/components/chat/chat-search-disclosure';
import { streamingPulse } from '$lib/components/chat/streaming-pulse';
import { safeOperationalDetailsTransition } from './chat-motion';
import './chat-operational-row.css';

export interface ChatOperationalRowProps {
  headerAdmitted?: boolean;
  headerHeight?: number;
  leading: ReactNode;
  summary: ReactNode;
  /** Keep summary controls beside the disclosure button, without nested interactive elements. */
  summaryContainsControls?: boolean;
  trailing?: ReactNode;
  showChevron?: boolean;
  preview?: ReactNode;
  details?: ReactNode;
  interactive?: boolean;
  expanded?: boolean;
  controls?: string;
  ariaLabel?: string;
  title?: string;
  summaryTitle?: string;
  onclick?: (event: MouseEvent) => void;
  onkeydown?: (event: KeyboardEvent) => void;
  detailsId?: string;
  previewClass?: string;
  detailsClass?: string;
  previewTransition?: (
    node: Element,
    params?: { tier?: SpringTierName; y?: number },
    options?: { direction?: 'in' | 'out' | 'both' },
  ) => MotionTransitionConfig;
  detailsTransition?: (node: Element) => MotionTransitionConfig;
  animateDetailsHeight?: boolean;
  detailsMotion?: string;
  detailsInert?: boolean;
  detailsAriaHidden?: boolean;
  triggerElement?: Ref<HTMLButtonElement>;
  detailsElement?: Ref<HTMLDivElement>;
  adjacentOperationalRow?: boolean;
  streaming?: boolean;
  toolIcon?: boolean;
  testId?: string;
  disclosureTestId?: string;
  summaryTestId?: string;
  toolUseId?: string;
  toolCallId?: string;
  conversationLayer?: string;
  searchDisclosureId?: string;
  summarySearchPath?: string;
  onSearchExpand?: () => void;
  onSearchRestore?: () => void;
  class?: string;
  className?: string;
}

function OperationalLeading({
  interactive,
  streaming,
  toolIcon,
  children,
}: Pick<ChatOperationalRowProps, 'interactive' | 'streaming' | 'toolIcon'> & {
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const Element = interactive ? 'span' : 'div';
  useLayoutEffect(() => {
    if (!ref.current) return;
    const pulse = streamingPulse(ref.current, streaming ?? false);
    return () => pulse?.destroy?.();
  }, [interactive, streaming]);
  return (
    <Element
      ref={ref as Ref<HTMLDivElement>}
      className={CHAT_OPERATIONAL_LEADING_CLASS}
      data-operational-leading=""
      data-operational-icon-box=""
      data-tool-icon={toolIcon || undefined}
    >
      {children}
    </Element>
  );
}

function OperationalTrigger({
  triggerElement,
  onclick,
  onkeydown,
  expanded,
  controls,
  ariaLabel,
  title,
  disclosureTestId,
  overlay = false,
  children,
}: Pick<
  ChatOperationalRowProps,
  | 'triggerElement'
  | 'onclick'
  | 'onkeydown'
  | 'expanded'
  | 'controls'
  | 'ariaLabel'
  | 'title'
  | 'disclosureTestId'
> & { children: ReactNode; overlay?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useImperativeHandle(triggerElement, () => ref.current!, []);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Keep native currentTarget, cancellation and keyboard defaults from the source API.
    if (onclick) node.addEventListener('click', onclick);
    if (onkeydown) node.addEventListener('keydown', onkeydown);
    return () => {
      if (onclick) node.removeEventListener('click', onclick);
      if (onkeydown) node.removeEventListener('keydown', onkeydown);
    };
  }, [onclick, onkeydown]);
  return (
    <Button
      ref={ref}
      variant="plain"
      type="button"
      truncateLabel={false}
      labelClass="type-body"
      className={cn(
        'type-body col-span-2 flex h-auto min-w-0 w-full cursor-pointer items-center justify-start gap-[var(--operational-leading-gap)] border-0 bg-transparent p-0 text-left focus-visible:underline focus-visible:underline-offset-2',
        overlay && 'peer absolute inset-0 h-full',
      )}
      data-testid={disclosureTestId}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-controls={controls}
      title={title ?? ariaLabel}
    >
      {children}
    </Button>
  );
}

function PreviewContent({
  present,
  onExit,
  transition,
  className,
  children,
}: {
  present: boolean;
  onExit: () => void;
  transition: ChatOperationalRowProps['previewTransition'];
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const transitionRef = useRef(transition);
  useLayoutEffect(() => {
    transitionRef.current = transition;
  }, [transition]);
  const outro = useCallback(
    (node: HTMLElement) =>
      transitionRef.current?.(node, {}, { direction: 'out' }) ?? { duration: 0 },
    [],
  );
  // An out-only source directive aborts and restores immediately on re-entry.
  usePresenceTransition(ref, present, onExit, outro, !present, false);
  return (
    <div ref={ref} className={className} data-operational-preview-content="" inert={!present}>
      {children}
    </div>
  );
}

type BindDetails = (node: HTMLDivElement) => () => void;

function bindElementRef(ref: ChatOperationalRowProps['detailsElement'], node: HTMLDivElement) {
  const cleanup = typeof ref === 'function' ? ref(node) : undefined;
  if (ref && typeof ref !== 'function') ref.current = node;
  return () => {
    if (typeof cleanup === 'function') cleanup();
    else if (typeof ref === 'function') ref(null);
    else if (ref) ref.current = null;
  };
}

/** An outgoing branch must not clear the ref of its newly mounted replacement. */
function useDetailsBinding(externalRef: ChatOperationalRowProps['detailsElement']): BindDetails {
  const current = useRef<(() => void) | undefined>(undefined);
  return useCallback(
    (node) => {
      current.current?.();
      const cleanup = bindElementRef(externalRef, node);
      const release = () => {
        if (current.current !== release) return;
        current.current = undefined;
        cleanup();
      };
      current.current = release;
      return release;
    },
    [externalRef],
  );
}

function AnimatedDetails({
  expanded,
  detailsId,
  detailsClass,
  detailsInert,
  detailsAriaHidden,
  bindDetails,
  children,
}: Pick<
  ChatOperationalRowProps,
  'detailsId' | 'detailsClass' | 'detailsInert' | 'detailsAriaHidden'
> & { expanded: boolean; bindDetails: BindDetails; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useAnimatedHeight(ref, expanded);
  useLayoutEffect(() => bindDetails(ref.current!), [bindDetails]);
  return (
    <div
      ref={ref}
      id={expanded ? detailsId : undefined}
      data-operational-expanded-content={expanded ? '' : undefined}
      data-response-group-motion="animated-height"
      inert={!expanded || detailsInert}
      aria-hidden={detailsAriaHidden ?? !expanded}
    >
      {expanded && <div className={detailsClass}>{children}</div>}
    </div>
  );
}

function TransitionDetails({
  detailsId,
  detailsClass,
  detailsMotion,
  detailsInert,
  detailsAriaHidden,
  detailsTransition = safeOperationalDetailsTransition,
  bindDetails,
  present,
  onExit,
  children,
}: Pick<
  ChatOperationalRowProps,
  | 'detailsId'
  | 'detailsClass'
  | 'detailsMotion'
  | 'detailsInert'
  | 'detailsAriaHidden'
  | 'detailsTransition'
> & {
  bindDetails?: BindDetails;
  present: boolean;
  onExit: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const transitionRef = useRef(detailsTransition);
  useLayoutEffect(() => {
    transitionRef.current = detailsTransition;
  }, [detailsTransition]);
  // Prop updates affect the next transition, without restarting one in flight.
  const transition = useCallback((node: HTMLElement) => transitionRef.current(node), []);
  usePresenceTransition(ref, present, onExit, transition);
  useLayoutEffect(() => bindDetails?.(ref.current!), [bindDetails]);
  return (
    <div
      ref={ref}
      id={detailsId}
      className={detailsClass}
      data-operational-expanded-content=""
      data-response-group-motion={detailsMotion}
      inert={detailsInert || !present}
      aria-hidden={detailsAriaHidden}
    >
      {children}
    </div>
  );
}

export function ChatOperationalRow({
  headerAdmitted = true,
  headerHeight = 28,
  leading,
  summary,
  summaryContainsControls = false,
  trailing,
  showChevron = true,
  preview,
  details,
  interactive = false,
  expanded = false,
  controls,
  ariaLabel,
  title,
  summaryTitle,
  onclick,
  onkeydown,
  detailsId,
  previewClass = '',
  detailsClass = '',
  previewTransition,
  detailsTransition = safeOperationalDetailsTransition,
  animateDetailsHeight = false,
  detailsMotion,
  detailsInert = false,
  detailsAriaHidden,
  triggerElement,
  detailsElement,
  adjacentOperationalRow = false,
  streaming = false,
  toolIcon = false,
  testId,
  disclosureTestId,
  summaryTestId,
  toolUseId,
  toolCallId,
  conversationLayer,
  searchDisclosureId,
  summarySearchPath,
  onSearchExpand,
  onSearchRestore,
  class: sourceClass,
  className,
}: ChatOperationalRowProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    const events = searchDisclosureEvents(root.current, {
      onExpand: onSearchExpand,
      onRestore: onSearchRestore,
    });
    return () => events.destroy();
  }, [onSearchExpand, onSearchRestore]);
  const previews = useMemo(
    () => (preview != null && preview !== false ? [preview] : []),
    [preview],
  );
  const previewPresence = usePresence(previews, () => 'preview');
  const detailItems = useMemo(
    () => (!animateDetailsHeight && details != null && details !== false ? [details] : []),
    [animateDetailsHeight, details],
  );
  const detailsPresence = usePresence(detailItems, () => 'details');
  const bindDetails = useDetailsBinding(detailsElement);
  const leadingContent = (
    <OperationalLeading interactive={interactive} streaming={streaming} toolIcon={toolIcon}>
      {leading}
    </OperationalLeading>
  );
  const summaryContent = (
    <span
      className={cn(
        CHAT_OPERATIONAL_SUMMARY_CLASS,
        interactive && 'flex-1',
        summaryContainsControls &&
          'pointer-events-none relative [&_button]:pointer-events-auto peer-focus-visible:underline peer-focus-visible:underline-offset-2',
      )}
      data-operational-summary=""
      data-tool-sentence={toolIcon || undefined}
      data-testid={summaryTestId}
      data-chat-search-block-path={summarySearchPath}
      aria-label={interactive ? undefined : ariaLabel}
      title={interactive ? summaryTitle : (summaryTitle ?? ariaLabel)}
    >
      {summary}
    </span>
  );
  return (
    <div
      ref={root}
      className={`${CHAT_OPERATIONAL_CONTAINER_CLASS} ${sourceClass ?? ''} ${className ?? ''}`}
      data-chat-operational-row={headerAdmitted ? '' : undefined}
      data-operational-row-container=""
      data-adjacent-operational-row={adjacentOperationalRow || undefined}
      data-testid={testId}
      data-tool-use-id={toolUseId}
      data-tool-call-id={toolCallId}
      data-conversation-layer={conversationLayer}
      data-chat-search-disclosure-id={searchDisclosureId}
      data-chat-search-expanded={searchDisclosureId ? expanded : undefined}
    >
      {headerAdmitted ? (
        <div
          className={CHAT_OPERATIONAL_ROW_CLASS}
          data-operational-disclosure-row=""
          data-compact-tool-row=""
        >
          {interactive && summaryContainsControls ? (
            <div className="relative col-span-2 flex min-w-0 items-center gap-[var(--operational-leading-gap)]">
              <OperationalTrigger
                {...{
                  triggerElement,
                  onclick,
                  onkeydown,
                  expanded,
                  controls,
                  ariaLabel,
                  title,
                  disclosureTestId,
                }}
                overlay
              >
                {null}
              </OperationalTrigger>
              {leadingContent}
              {summaryContent}
            </div>
          ) : interactive ? (
            <OperationalTrigger
              {...{
                triggerElement,
                onclick,
                onkeydown,
                expanded,
                controls,
                ariaLabel,
                title,
                disclosureTestId,
              }}
            >
              {leadingContent}
              {summaryContent}
            </OperationalTrigger>
          ) : (
            <>
              {leadingContent}
              {summaryContent}
            </>
          )}
          {((trailing != null && trailing !== false) || (interactive && showChevron)) && (
            <span className={CHAT_OPERATIONAL_TRAILING_CLASS} data-operational-trailing="">
              {trailing}
              {interactive && showChevron && (
                <span data-operational-chevron="">
                  <CaretDownIcon
                    size={16}
                    aria-hidden="true"
                    className={cn(CHAT_OPERATIONAL_CHEVRON_CLASS, !expanded && 'rotate-90')}
                  />
                </span>
              )}
            </span>
          )}
        </div>
      ) : (
        <div
          style={{ height: headerHeight }}
          data-operational-header-spacer=""
          aria-hidden="true"
        />
      )}
      {previewPresence.entries.map(({ key, value, present }) => (
        <PreviewContent
          key={key}
          present={present}
          onExit={() => previewPresence.remove(key)}
          transition={previewTransition}
          className={previewClass}
        >
          {value}
        </PreviewContent>
      ))}
      {animateDetailsHeight && details != null && details !== false && (
        <AnimatedDetails
          {...{ expanded, detailsId, detailsClass, detailsInert, detailsAriaHidden, bindDetails }}
        >
          {details}
        </AnimatedDetails>
      )}
      {detailsPresence.entries.map(({ key, value, present }) => (
        <TransitionDetails
          key={key}
          {...{
            detailsId,
            detailsClass,
            detailsMotion,
            detailsInert,
            detailsAriaHidden,
            detailsTransition,
            present,
          }}
          bindDetails={animateDetailsHeight ? undefined : bindDetails}
          onExit={() => detailsPresence.remove(key)}
        >
          {value}
        </TransitionDetails>
      ))}
    </div>
  );
}

export default ChatOperationalRow;
