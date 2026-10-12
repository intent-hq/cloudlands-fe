// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BlockerReportNotice } from '@/features/chat/components/blocker-report-notice';
import { ChatAgentActionBlock } from '@/features/chat/components/chat-agent-action-block';
import { ChatNotice } from '@/features/chat/components/chat-notice';
import { safeDisclosureTransition } from '@/features/chat/components/chat-motion';
import { ChatOperationalRow } from '@/features/chat/components/chat-operational-row';
import { FailureDetails } from '@/features/chat/components/failure-details';
import { InterruptionNotice } from '@/features/chat/components/interruption-notice';
import { StreamingTypingIndicator } from '@/features/chat/components/streaming-typing-indicator';
import { ToolStatusIcon } from '@/features/chat/components/tool-status-icon';
import { usePresence } from '@/lib/motion';
import { requestSearchDisclosure } from '$lib/components/chat/chat-search-disclosure';
import {
  followBottom,
  followToBottom,
  hasActiveFollowBottomMutation,
  isFollowingBottom,
  type FollowBottomState,
} from '$lib/utils/smartScroll';

function BooleanField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={value} onCheckedChange={onChange} />
      )}
    />
  );
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <FormField
      label={label}
      control={(field) =>
        multiline ? (
          <Textarea {...field} value={value} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <Input {...field} value={value} onChange={(event) => onChange(event.target.value)} />
        )
      }
    />
  );
}

function ChoiceField<K extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly K[];
  value: K;
  onChange: (value: K) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <ToggleGroup
          id={field.id}
          type="single"
          aria-label={label}
          className="min-w-0 flex-wrap justify-start"
          value={value}
          onValueChange={(next) => {
            if (choices.includes(next as K)) onChange(next as K);
          }}
        >
          {choices.map((choice) => (
            <ToggleGroupItem key={choice} value={choice}>
              {choice}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Record({ id, value }: { id: string; value: unknown }) {
  return (
    <pre className="min-w-0 whitespace-pre-wrap wrap-anywhere" data-testid={id}>
      {JSON.stringify(value, (_key, item) => (item === undefined ? '[undefined]' : item), 2)}
    </pre>
  );
}

function Exercise({
  id,
  name,
  controls,
  inputs,
  observations,
  children,
}: {
  id: string;
  name: string;
  controls: ReactNode;
  inputs: unknown;
  observations?: unknown;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label={`${name} exercise`}
      data-testid={id}
    >
      <h3>{name}</h3>
      {controls}
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label={`Mount ${name}`} value={mounted} onChange={setMounted} />
        <Button disabled={!mounted} onClick={() => setRevision((current) => current + 1)}>
          Remount {name}
        </Button>
      </div>
      {mounted && (
        <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
          {children}
        </div>
      )}
      <Record id={`${id}-state`} value={{ mounted, revision, inputs, observations }} />
    </section>
  );
}

// The import-free canonical action owns all scroll policy and geometry. React only
// attaches it to an actual scroll viewport and disposes it with that viewport.
function FollowHost({
  children,
  onViewport,
}: {
  children: ReactNode;
  onViewport: (node: HTMLElement) => void;
}) {
  const viewport = useRef<HTMLElement>(null);
  const action = useRef<ReturnType<typeof followBottom> | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [follow, setFollow] = useState(true);
  const [geometry, setGeometry] = useState<FollowBottomState | null>(null);
  const [followCallbacks, setFollowCallbacks] = useState<boolean[]>([]);
  const [snapshot, setSnapshot] = useState<{
    isFollowing: boolean;
    hasActiveMutation: boolean;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null>(null);
  const onFollowChange = useCallback((value: boolean) => {
    setFollow(value);
    setFollowCallbacks((current) => [...current, value]);
  }, []);
  useLayoutEffect(() => {
    if (!viewport.current) return;
    const instance = followBottom(viewport.current, {
      follow: true,
      onFollowChange,
      onScrollStateChange: setGeometry,
      layoutNeutralBottomAnchor: true,
    });
    action.current = instance;
    onViewport(viewport.current);
    return () => {
      instance.destroy();
      action.current = null;
    };
  }, [onFollowChange, onViewport]);
  useLayoutEffect(() => {
    action.current?.update({ enabled, follow, onFollowChange, onScrollStateChange: setGeometry });
  }, [enabled, follow, onFollowChange]);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Enable row scroll following" value={enabled} onChange={setEnabled} />
        <Button
          disabled={!enabled}
          onClick={() => {
            if (viewport.current) followToBottom(viewport.current);
          }}
        >
          Follow row to bottom
        </Button>
        <Button
          onClick={() => {
            const node = viewport.current;
            if (node)
              setSnapshot({
                isFollowing: isFollowingBottom(node),
                hasActiveMutation: hasActiveFollowBottomMutation(node),
                scrollTop: node.scrollTop,
                scrollHeight: node.scrollHeight,
                clientHeight: node.clientHeight,
              });
          }}
        >
          Read row scroll state
        </Button>
      </div>
      <section
        ref={viewport}
        aria-label="Disclosure scroll viewport"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The real scroll viewport needs native keyboard scrolling and follow policy input.
        tabIndex={0}
        data-testid="chat-disclosure-scroll-host"
        className="h-64 min-w-0 overflow-y-auto"
      >
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index}>
              Caller paragraph {index + 1}: scroll upward to pause following, then expand the row
              below.
            </p>
          ))}
          {children}
        </div>
      </section>
      <Record
        id="chat-disclosure-scroll-state"
        value={{ enabled, follow, geometry, followCallbacks, snapshot }}
      />
    </div>
  );
}

type CallbackRecord = {
  sequence: number;
  identity: string;
  kind: string;
  type?: string;
  key?: string;
  isTrusted?: boolean;
  defaultPrevented?: boolean;
  targetId?: string;
};
type NodeObservation = { identity: number; connected: boolean; id: string; tag: string } | null;
type ScrollObservation = {
  connected: boolean;
  isFollowing: boolean;
  hasActiveMutation: boolean;
} | null;

// The source row's transition prop accepts Element; keep the shared recipe and
// bidirectional mode while satisfying that public caller signature.
const rowDisclosureTransition = (node: Element) =>
  safeDisclosureTransition(node, { tier: 'moderate' }, { direction: 'both' });

function OperationalExercise() {
  const [rowMounted, setRowMounted] = useState(true);
  const [interactive, setInteractive] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [animateDetailsHeight, setAnimateDetailsHeight] = useState(true);
  const [disclosureDetails, setDisclosureDetails] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [animatePreview, setAnimatePreview] = useState(false);
  const [showTrailing, setShowTrailing] = useState(true);
  const [showChevron, setShowChevron] = useState(true);
  const [headerAdmitted, setHeaderAdmitted] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [detailsInert, setDetailsInert] = useState(false);
  const [detailsAriaHidden, setDetailsAriaHidden] = useState(false);
  const [preventKeyboard, setPreventKeyboard] = useState(false);
  const [summary, setSummary] = useState('Inspect caller-controlled operation');
  const [detailsText, setDetailsText] = useState(
    'Caller detail paragraph.\nChange this text while expanded to exercise content growth.',
  );
  const [previewText, setPreviewText] = useState('Caller preview slot');
  const [trailingText, setTrailingText] = useState('Caller trailing slot');
  const [identity, setIdentity] = useState<'primary' | 'replacement'>('primary');
  const [callbacks, setCallbacks] = useState<CallbackRecord[]>([]);
  const [refs, setRefs] = useState<Record<string, NodeObservation>>({
    trigger: null,
    details: null,
    lastTrigger: null,
    lastDetails: null,
  });
  const nodes = useRef<{
    trigger: HTMLButtonElement | null;
    details: HTMLDivElement | null;
    lastTrigger: HTMLButtonElement | null;
    lastDetails: HTMLDivElement | null;
  }>({ trigger: null, details: null, lastTrigger: null, lastDetails: null });
  const nodeIds = useRef(new WeakMap<HTMLElement, number>());
  const nextId = useRef(0);
  const retainedRow = useRef<HTMLElement | null>(null);
  const bindRowHost = useCallback((node: HTMLDivElement | null) => {
    // Keep the actual removed row so native search controls can exercise its
    // disposed listener, rather than silently skipping the request on teardown.
    if (node) retainedRow.current = node.querySelector('[data-operational-row-container]');
  }, []);
  const scrollNodes = useRef<{ current: HTMLElement | null; previous: HTMLElement | null }>({
    current: null,
    previous: null,
  });
  const [scrollLifetime, setScrollLifetime] = useState<{
    current: ScrollObservation;
    previous: ScrollObservation;
  } | null>(null);
  const onViewport = useCallback((node: HTMLElement) => {
    if (scrollNodes.current.current !== node) {
      scrollNodes.current.previous = scrollNodes.current.current;
      scrollNodes.current.current = node;
    }
  }, []);
  const readScrollLifetime = () => {
    const observe = (node: HTMLElement | null): ScrollObservation =>
      node
        ? {
            connected: node.isConnected,
            isFollowing: isFollowingBottom(node),
            hasActiveMutation: hasActiveFollowBottomMutation(node),
          }
        : null;
    setScrollLifetime({
      current: observe(scrollNodes.current.current),
      previous: observe(scrollNodes.current.previous),
    });
  };
  const readRefs = useCallback(() => {
    const observe = (node: HTMLElement | null): NodeObservation => {
      if (!node) return null;
      let nodeId = nodeIds.current.get(node);
      if (nodeId === undefined) {
        nodeId = ++nextId.current;
        nodeIds.current.set(node, nodeId);
      }
      return { identity: nodeId, connected: node.isConnected, id: node.id, tag: node.tagName };
    };
    setRefs({
      trigger: observe(nodes.current.trigger),
      details: observe(nodes.current.details),
      lastTrigger: observe(nodes.current.lastTrigger),
      lastDetails: observe(nodes.current.lastDetails),
      row: observe(retainedRow.current),
    });
  }, []);
  const triggerElement = useCallback(
    (node: HTMLButtonElement | null) => {
      if (!node) nodes.current.lastTrigger = nodes.current.trigger;
      nodes.current.trigger = node;
      readRefs();
    },
    [readRefs],
  );
  const detailsElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) nodes.current.lastDetails = nodes.current.details;
      nodes.current.details = node;
      readRefs();
    },
    [readRefs],
  );
  const record = useCallback(
    (kind: string, event?: MouseEvent | KeyboardEvent) => {
      const native = event
        ? {
            type: event.type,
            key: 'key' in event ? event.key : undefined,
            isTrusted: event.isTrusted,
            defaultPrevented: event.defaultPrevented,
            targetId:
              event.currentTarget instanceof HTMLElement ? event.currentTarget.id : undefined,
          }
        : {};
      setCallbacks((current) => [
        ...current,
        { sequence: current.length + 1, identity, kind, ...native },
      ]);
    },
    [identity],
  );
  const onSearchExpand = useCallback(() => {
    record('search-expand');
    setExpanded(true);
  }, [record]);
  const onSearchRestore = useCallback(() => {
    record('search-restore');
    setExpanded(false);
  }, [record]);
  const search = (open: boolean) => {
    const row = retainedRow.current;
    if (row) requestSearchDisclosure(row, open);
  };
  return (
    <Exercise
      id="chat-operational"
      name="ChatOperationalRow"
      inputs={{
        rowMounted,
        interactive,
        expanded,
        animateDetailsHeight,
        disclosureDetails,
        showDetails,
        showPreview,
        animatePreview,
        showTrailing,
        showChevron,
        headerAdmitted,
        streaming,
        detailsInert,
        detailsAriaHidden,
        preventKeyboard,
        summary,
        detailsText,
        previewText,
        trailingText,
        identity,
      }}
      observations={{ callbacks, refs, scrollLifetime }}
      controls={
        <>
          <TextField label="Row summary" value={summary} onChange={setSummary} />
          <TextField
            label="Row details text"
            value={detailsText}
            onChange={setDetailsText}
            multiline
          />
          <TextField label="Row preview text" value={previewText} onChange={setPreviewText} />
          <TextField label="Row trailing text" value={trailingText} onChange={setTrailingText} />
          <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
            <BooleanField
              label="Mount row within scroll host"
              value={rowMounted}
              onChange={setRowMounted}
            />
            <BooleanField label="Interactive row" value={interactive} onChange={setInteractive} />
            <BooleanField label="Expand row" value={expanded} onChange={setExpanded} />
            <BooleanField
              label="Animate row details height"
              value={animateDetailsHeight}
              onChange={setAnimateDetailsHeight}
            />
            <BooleanField
              label="Use disclosure row details motion"
              value={disclosureDetails}
              onChange={setDisclosureDetails}
            />
            <BooleanField label="Show row details" value={showDetails} onChange={setShowDetails} />
            <BooleanField label="Show row preview" value={showPreview} onChange={setShowPreview} />
            <BooleanField
              label="Animate row preview"
              value={animatePreview}
              onChange={setAnimatePreview}
            />
            <BooleanField
              label="Show row trailing"
              value={showTrailing}
              onChange={setShowTrailing}
            />
            <BooleanField label="Show row chevron" value={showChevron} onChange={setShowChevron} />
            <BooleanField
              label="Admit row header"
              value={headerAdmitted}
              onChange={setHeaderAdmitted}
            />
            <BooleanField label="Stream row" value={streaming} onChange={setStreaming} />
            <BooleanField
              label="Make row details inert"
              value={detailsInert}
              onChange={setDetailsInert}
            />
            <BooleanField
              label="Hide row details from accessibility"
              value={detailsAriaHidden}
              onChange={setDetailsAriaHidden}
            />
            <BooleanField
              label="Prevent row keyboard activation"
              value={preventKeyboard}
              onChange={setPreventKeyboard}
            />
          </div>
          <ChoiceField
            label="Row callback identity"
            choices={['primary', 'replacement']}
            value={identity}
            onChange={setIdentity}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => search(true)}>Search expand row</Button>
            <Button onClick={() => search(false)}>Search restore row</Button>
            <Button onClick={readRefs}>Read row refs</Button>
            <Button onClick={readScrollLifetime}>Read row scroll lifetime</Button>
          </div>
        </>
      }
    >
      <FollowHost onViewport={onViewport}>
        <div className="min-w-0" data-testid="chat-operational-native-frame">
          {rowMounted && (
            <div ref={bindRowHost} className="min-w-0">
              <ChatOperationalRow
                headerAdmitted={headerAdmitted}
                interactive={interactive}
                expanded={expanded}
                animateDetailsHeight={animateDetailsHeight}
                detailsTransition={disclosureDetails ? rowDisclosureTransition : undefined}
                streaming={streaming}
                toolIcon
                leading={<ToolStatusIcon status={streaming ? 'running' : 'completed'} />}
                summary={summary}
                trailing={showTrailing ? <span>{trailingText}</span> : undefined}
                showChevron={showChevron}
                preview={showPreview ? <p className="wrap-anywhere">{previewText}</p> : undefined}
                previewTransition={animatePreview ? safeDisclosureTransition : undefined}
                details={
                  showDetails && (animateDetailsHeight || expanded) ? (
                    <div className="grid min-w-0 gap-2">
                      <p className="whitespace-pre-wrap wrap-anywhere">{detailsText}</p>
                      <Button onClick={() => record('detail-action')}>Activate row detail</Button>
                    </div>
                  ) : undefined
                }
                ariaLabel="Toggle caller operation"
                controls="caller-row-details"
                detailsId="caller-row-details"
                detailsInert={detailsInert}
                detailsAriaHidden={detailsAriaHidden ? true : undefined}
                triggerElement={triggerElement}
                detailsElement={detailsElement}
                testId="operational-row"
                disclosureTestId="operational-trigger"
                summaryTestId="operational-summary"
                searchDisclosureId="caller-operation"
                summarySearchPath="caller-summary"
                onSearchExpand={onSearchExpand}
                onSearchRestore={onSearchRestore}
                onclick={(event) => {
                  record('click', event);
                  setExpanded((value) => !value);
                }}
                onkeydown={(event) => {
                  if (preventKeyboard && (event.key === 'Enter' || event.key === ' '))
                    event.preventDefault();
                  record('keydown', event);
                }}
              />
            </div>
          )}
        </div>
      </FollowHost>
    </Exercise>
  );
}

function TypingExercise() {
  const [visible, setVisible] = useState(true);
  const [compact, setCompact] = useState(false);
  const [showMessage, setShowMessage] = useState(true);
  const [message, setMessage] = useState('Caller typing message');
  const [lifecycleMessage, setLifecycleMessage] = useState('Caller phase');
  const [elapsed, setElapsed] = useState('Caller elapsed');
  const [variant, setVariant] = useState<'bloom' | 'pulse' | 'twist'>('bloom');
  const [identity, setIdentity] = useState<'primary' | 'replacement'>('primary');
  const [hoverCallbacks, setHoverCallbacks] = useState<
    { sequence: number; identity: string; hovered: boolean }[]
  >([]);
  const onHoverChange = useCallback(
    (hovered: boolean) => {
      setHoverCallbacks((current) => [
        ...current,
        { sequence: current.length + 1, identity, hovered },
      ]);
    },
    [identity],
  );
  return (
    <Exercise
      id="chat-typing"
      name="StreamingTypingIndicator"
      inputs={{
        visible,
        compact,
        showMessage,
        message,
        lifecycleMessage,
        elapsed,
        variant,
        identity,
      }}
      observations={{ hoverCallbacks }}
      controls={
        <>
          <BooleanField label="Show typing indicator" value={visible} onChange={setVisible} />
          <BooleanField label="Compact typing indicator" value={compact} onChange={setCompact} />
          <BooleanField label="Show typing message" value={showMessage} onChange={setShowMessage} />
          <TextField label="Typing message" value={message} onChange={setMessage} />
          <TextField label="Typing phase" value={lifecycleMessage} onChange={setLifecycleMessage} />
          <TextField label="Typing elapsed" value={elapsed} onChange={setElapsed} />
          <ChoiceField
            label="Typing variant"
            choices={['bloom', 'pulse', 'twist']}
            value={variant}
            onChange={setVariant}
          />
          <ChoiceField
            label="Typing callback identity"
            choices={['primary', 'replacement']}
            value={identity}
            onChange={setIdentity}
          />
        </>
      }
    >
      <StreamingTypingIndicator
        visible={visible}
        compact={compact}
        showMessage={showMessage}
        message={message}
        lifecycleMessage={lifecycleMessage}
        elapsed={elapsed}
        variant={variant}
        onHoverChange={onHoverChange}
      />
    </Exercise>
  );
}

function NoticePresence({
  present,
  onExit,
  children,
}: {
  present: boolean;
  onExit: () => void;
  children: (present: boolean, onExit: () => void) => ReactNode;
}) {
  const items = useMemo(() => (present ? ['notice'] : []), [present]);
  const { entries, remove } = usePresence(items, (item) => item);
  return entries.map((entry) => (
    <div key={entry.key} className="min-w-0">
      {children(entry.present, () => {
        onExit();
        remove(entry.key);
      })}
    </div>
  ));
}

function NoticeExercise() {
  const [present, setPresent] = useState(true);
  const [exitCount, setExitCount] = useState(0);
  const [title, setTitle] = useState('Caller attention title');
  const [reason, setReason] = useState('Caller reason\nA second line remains part of the reason.');
  const [timestamp, setTimestamp] = useState('2026-10-01T12:00:00Z');
  const [includeTimestamp, setIncludeTimestamp] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [tone, setTone] = useState<'danger' | 'warning'>('warning');
  return (
    <Exercise
      id="chat-notice"
      name="ChatNotice"
      inputs={{
        title,
        reason,
        timestamp: includeTimestamp ? timestamp : undefined,
        announce,
        tone,
        present,
      }}
      observations={{ exitCount }}
      controls={
        <>
          <TextField label="Notice title" value={title} onChange={setTitle} />
          <TextField label="Notice reason" value={reason} onChange={setReason} multiline />
          <TextField label="Notice timestamp" value={timestamp} onChange={setTimestamp} />
          <BooleanField
            label="Include notice timestamp"
            value={includeTimestamp}
            onChange={setIncludeTimestamp}
          />
          <BooleanField label="Announce notice" value={announce} onChange={setAnnounce} />
          <ChoiceField
            label="Notice tone"
            choices={['warning', 'danger']}
            value={tone}
            onChange={setTone}
          />
          <BooleanField label="Present ChatNotice" value={present} onChange={setPresent} />
        </>
      }
    >
      <NoticePresence present={present} onExit={() => setExitCount((current) => current + 1)}>
        {(isPresent, onExit) => (
          <ChatNotice
            title={title}
            reason={reason}
            timestamp={includeTimestamp ? timestamp : undefined}
            announce={announce}
            tone={tone}
            testIdPrefix="exercise-notice"
            present={isPresent}
            onExit={onExit}
          />
        )}
      </NoticePresence>
    </Exercise>
  );
}

function InterruptionExercise() {
  const [present, setPresent] = useState(true);
  const [exitCount, setExitCount] = useState(0);
  const [message, setMessage] = useState('Caller interruption explanation');
  const [useDefault, setUseDefault] = useState(true);
  return (
    <Exercise
      id="chat-interruption"
      name="InterruptionNotice"
      inputs={{ message: useDefault ? undefined : message, present }}
      observations={{ exitCount }}
      controls={
        <>
          <BooleanField
            label="Use default interruption message"
            value={useDefault}
            onChange={setUseDefault}
          />
          <TextField label="Interruption message" value={message} onChange={setMessage} multiline />
          <BooleanField label="Present InterruptionNotice" value={present} onChange={setPresent} />
        </>
      }
    >
      <NoticePresence present={present} onExit={() => setExitCount((current) => current + 1)}>
        {(isPresent, onExit) => (
          <InterruptionNotice
            message={useDefault ? undefined : message}
            present={isPresent}
            onExit={onExit}
          />
        )}
      </NoticePresence>
    </Exercise>
  );
}

function BlockerExercise() {
  const [present, setPresent] = useState(true);
  const [exitCount, setExitCount] = useState(0);
  const [reason, setReason] = useState('Caller blocker reason');
  return (
    <Exercise
      id="chat-blocker"
      name="BlockerReportNotice"
      inputs={{ reason, present }}
      observations={{ exitCount }}
      controls={
        <>
          <TextField label="Blocker reason" value={reason} onChange={setReason} multiline />
          <BooleanField label="Present BlockerReportNotice" value={present} onChange={setPresent} />
        </>
      }
    >
      <NoticePresence present={present} onExit={() => setExitCount((current) => current + 1)}>
        {(isPresent, onExit) => (
          <BlockerReportNotice reason={reason} present={isPresent} onExit={onExit} />
        )}
      </NoticePresence>
    </Exercise>
  );
}

function FailureExercise() {
  const [pasted, setPasted] = useState('');
  const [text, setText] = useState(
    'Caller diagnostic text\nThe clipboard should contain exactly this text.',
  );
  const [label, setLabel] = useState('Inspect caller diagnostics');
  const [useDefault, setUseDefault] = useState(true);
  return (
    <Exercise
      id="chat-failure"
      name="FailureDetails"
      inputs={{ text, label: useDefault ? undefined : label }}
      observations={{ pasted }}
      controls={
        <>
          <TextField label="Failure text" value={text} onChange={setText} multiline />
          <TextField label="Failure toggle label" value={label} onChange={setLabel} />
          <BooleanField
            label="Use default failure label"
            value={useDefault}
            onChange={setUseDefault}
          />
          <TextField
            label="Paste copied failure text"
            value={pasted}
            onChange={setPasted}
            multiline
          />
        </>
      }
    >
      <FailureDetails text={text} label={useDefault ? undefined : label} />
    </Exercise>
  );
}

function AgentActionExercise() {
  const [goal, setGoal] = useState('Caller goal shown by the action block');
  return (
    <Exercise
      id="chat-agent-action"
      name="ChatAgentActionBlock"
      inputs={{ goal }}
      controls={<TextField label="Agent action goal" value={goal} onChange={setGoal} />}
    >
      <ChatAgentActionBlock goal={goal} />
    </Exercise>
  );
}

function CssMotionExercise() {
  const [draft, setDraft] = useState('Local panel draft');
  return (
    <Exercise
      id="chat-disclosure-css"
      name="CollapsiblePanel"
      inputs={{ draft }}
      controls={
        <p>This existing panel uses only local state; its disclosure does not save a preference.</p>
      }
    >
      <CollapsiblePanel
        title="Local CSS motion panel"
        showChevronOnHover={false}
        showGradient={false}
      >
        <TextField label="CSS panel draft" value={draft} onChange={setDraft} />
      </CollapsiblePanel>
    </Exercise>
  );
}

export function ChatDisclosureExamples() {
  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      data-testid="chat-disclosure-examples"
      data-functional-example="chat-disclosure"
    >
      <p className="type-caption text-muted-foreground">
        Internal caller-controlled leaves. Native interaction and visual acceptance remain separate.
      </p>
      <OperationalExercise />
      <TypingExercise />
      <NoticeExercise />
      <InterruptionExercise />
      <BlockerExercise />
      <FailureExercise />
      <AgentActionExercise />
      <CssMotionExercise />
    </div>
  );
}
