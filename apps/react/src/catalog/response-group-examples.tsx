// i18n-ignore (internal, unreleased catalog inputs and caller observations)
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CylinderScroller } from '@/features/chat/components/cylinder-scroller';
import { InlineMarkdownSnippet } from '@/features/chat/components/inline-markdown-snippet';
import { ResponseGroup, type ResponseGroupProps } from '@/features/chat/components/response-group';
import { requestSearchDisclosure } from '$lib/components/chat/chat-search-disclosure';
import { OPERATIONAL_GROUP_CHILD_CONTENT_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import { getResponseGroupBlockKeys } from '$lib/components/chat/response-group-blocks';
import { followBottom } from '$lib/utils/smartScroll';
import type { ContentBlock } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';

type Flag = 'omit' | 'true' | 'false';
type Saved = NonNullable<ResponseGroupProps['saved']>;
type Observation = Record<string, unknown>;
type ObservationChannels = Record<'native' | 'ownership' | 'callbacks' | 'follow', Observation[]>;
const flags = ['omit', 'true', 'false'] as const;
const groupFlags = [
  'isStreaming',
  'isTerminal',
  'isLastConversationMessage',
  'reasoningPhase',
  'headerAdmitted',
  'adjacentOperationalRow',
] as const;
type GroupFlag = (typeof groupFlags)[number];
const blockModes = ['omit', 'empty', 'text', 'thinking', 'code', 'tool-result', 'mixed'] as const;
type BlockMode = (typeof blockModes)[number];

function Toggle({
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

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <ToggleGroup
          {...field}
          type="single"
          aria-label={label}
          value={value}
          className="min-w-0 max-w-full flex-wrap justify-start"
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
          <Textarea
            {...field}
            rows={3}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        ) : (
          <Input
            {...field}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        )
      }
    />
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      description="Leave empty to omit this prop."
      control={(field) => (
        <Input
          {...field}
          type="number"
          min={0}
          max={600}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    />
  );
}

function optionalNumber(value: string) {
  return value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function Output({ label, value }: { label: string; value: unknown }) {
  return (
    <output
      aria-label={label}
      className="block max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(value, null, 2)}
    </output>
  );
}

// Caller inputs, not a model of disclosure or preview selection.
function rawBlocks(mode: BlockMode, text: string): ContentBlock[] | undefined {
  switch (mode) {
    case 'omit':
      return undefined;
    case 'empty':
      return [];
    case 'text':
      return [{ type: 'text', text }];
    case 'thinking':
      return [{ type: 'thinking', id: 'reasoning', text }];
    case 'code':
      return [{ type: 'code', id: 'code', language: 'text', text }];
    case 'tool-result':
      return [{ type: 'tool_result', id: 'result', tool_use_id: 'read', content: text }];
    case 'mixed':
      return [
        { type: 'tool_result', id: 'prior-result', tool_use_id: 'prior', content: 'Prior result' },
        { type: 'text', text },
        { type: 'thinking', id: 'next-reasoning', text: 'A later reasoning block' },
        { type: 'tool_result', id: 'next-result', tool_use_id: 'next', content: 'Later result' },
      ];
  }
}

function useObservations() {
  const records = useRef<ObservationChannels>({
    native: [],
    ownership: [],
    callbacks: [],
    follow: [],
  });
  const objects = useRef({ next: 0, ids: new WeakMap<object, number>() });
  const [snapshot, setSnapshot] = useState<ObservationChannels>({
    native: [],
    ownership: [],
    callbacks: [],
    follow: [],
  });
  const record = useCallback((entry: Observation) => {
    // Scroll traffic cannot evict the child cleanup or callback replacement receipts.
    const channel =
      entry.kind === 'native'
        ? 'native'
        : entry.kind === 'child-attached' || entry.kind === 'child-released'
          ? 'ownership'
          : entry.kind === 'follow-geometry' || entry.kind === 'follow-callback'
            ? 'follow'
            : 'callbacks';
    records.current[channel] = [...records.current[channel].slice(-31), entry];
  }, []);
  const objectId = useCallback((value: object) => {
    let id = objects.current.ids.get(value);
    if (id === undefined) {
      id = ++objects.current.next;
      objects.current.ids.set(value, id);
    }
    return id;
  }, []);
  const describe = useCallback(
    (value: EventTarget | null) => {
      if (!(value instanceof Element)) return null;
      return {
        objectId: objectId(value),
        tag: value.tagName,
        id: value.id,
        testId: value.getAttribute('data-testid'),
        label: value.getAttribute('aria-label'),
        connected: value.isConnected,
      };
    },
    [objectId],
  );
  const eventSnapshot = useCallback(
    (event: Event) => {
      // Never retain an Event or claim its currentTarget after dispatch has ended.
      if (event.eventPhase === Event.NONE) return null;
      return {
        objectId: objectId(event),
        type: event.type,
        isTrusted: event.isTrusted,
        target: describe(event.target),
        currentTarget: describe(event.currentTarget),
        eventPhase: event.eventPhase,
        defaultPrevented: event.defaultPrevented,
        ...(event instanceof KeyboardEvent ? { key: event.key, shiftKey: event.shiftKey } : {}),
        ...(event instanceof WheelEvent
          ? { deltaY: event.deltaY, deltaMode: event.deltaMode }
          : {}),
        ...(event.target instanceof HTMLInputElement
          ? {
              value: event.target.value,
              selectionStart: event.target.selectionStart,
              selectionEnd: event.target.selectionEnd,
            }
          : {}),
      };
    },
    [describe, objectId],
  );
  const attachFrame = useCallback(
    (node: HTMLElement) => {
      const cleanup = [
        'click',
        'keydown',
        'keyup',
        'input',
        'focusin',
        'focusout',
        'wheel',
        'scroll',
        'touchstart',
        'touchmove',
        'touchend',
        'chatsearchexpand',
        'chatsearchrestore',
      ].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            record({
              kind: 'native',
              phase: capture ? 'capture' : 'bubble',
              ...eventSnapshot(event),
            });
          };
          node.addEventListener(type, listener, { capture, passive: true });
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => cleanup.forEach((release) => release());
    },
    [eventSnapshot, record],
  );
  return {
    record,
    describe,
    eventSnapshot,
    attachFrame,
    snapshot,
    refresh: () => setSnapshot({ ...records.current }),
    clear: () => {
      records.current = { native: [], ownership: [], callbacks: [], follow: [] };
      setSnapshot({ ...records.current });
    },
  };
}
type Observations = ReturnType<typeof useObservations>;

// This child owns its native input. The source group owns whether it exists.
function ExerciseChildren({
  label,
  blocks,
  lines,
  text,
  observations,
  onAction,
  onFinishStream,
  controlsAtBottom = false,
}: {
  label: string;
  blocks?: ContentBlock[];
  lines: number;
  text: string;
  observations: Observations;
  onAction: (event: MouseEvent) => void;
  onFinishStream?: (event: MouseEvent) => void;
  controlsAtBottom?: boolean;
}) {
  const { record, describe, eventSnapshot } = observations;
  const bindChild = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      record({ kind: 'child-attached', label, node: describe(node) });
      return () => {
        const details = node.closest<HTMLElement>('[data-operational-expanded-content]');
        record({
          kind: 'child-released',
          label,
          node: describe(node),
          details: describe(details),
          detailsInert: details?.inert ?? null,
          detailsAriaHidden: details?.getAttribute('aria-hidden') ?? null,
          inertAncestor: describe(node.closest('[inert]')),
          activeElement: describe(node.ownerDocument.activeElement),
          containsFocus: node.contains(node.ownerDocument.activeElement),
        });
      };
    },
    [label, describe, record],
  );
  const keys = getResponseGroupBlockKeys(blocks ?? []);
  const controls = (
    <>
      <FormField
        label={`${label} child edit`}
        control={(field) => (
          <Input
            {...field}
            defaultValue={`${label} editable value`}
            onChange={(event) => {
              record({ kind: 'child-input', label, event: eventSnapshot(event.nativeEvent) });
            }}
          />
        )}
      />
      <Button variant="outline" onClick={(event) => onAction(event.nativeEvent)}>
        {label} child action
      </Button>
      {onFinishStream && (
        <Button variant="outline" onClick={(event) => onFinishStream(event.nativeEvent)}>
          {label} finish stream
        </Button>
      )}
    </>
  );
  return (
    <div
      ref={bindChild}
      data-testid={`${label.toLowerCase()}-children`}
      data-response-group-child=""
      className={OPERATIONAL_GROUP_CHILD_CONTENT_CLASS}
    >
      <div className="grid min-w-0 grid-cols-1 gap-2">
        {!controlsAtBottom && controls}
        {(blocks ?? []).map((block, index) => (
          <div key={keys[index]} data-block-key={keys[index]}>
            <InlineMarkdownSnippet content={getContentBlockText(block)} />
          </div>
        ))}
        {Array.from({ length: lines }, (_, index) => (
          <p key={index} data-testid={`${label.toLowerCase()}-line`} className="wrap-anywhere">
            {label} line {index + 1}: {text}
          </p>
        ))}
        {controlsAtBottom && controls}
      </div>
    </div>
  );
}

function useGroupExercise(label: 'Primary' | 'Neighbor', observations: Observations) {
  const [name, setName] = useState(`${label} work`);
  const [values, setValues] = useState<Record<GroupFlag, Flag>>({
    isStreaming: 'omit',
    isTerminal: 'omit',
    isLastConversationMessage: 'omit',
    reasoningPhase: 'omit',
    headerAdmitted: 'omit',
    adjacentOperationalRow: 'omit',
  });
  const [headerHeight, setHeaderHeight] = useState('');
  const [mode, setMode] = useState<BlockMode>('text');
  const [text, setText] = useState(`${label} **summary** with a readable body.`);
  const [lines, setLines] = useState(6);
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [childKey, setChildKey] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [searchPath, setSearchPath] = useState(`response-${label.toLowerCase()}`);
  const [supplySearchPath, setSupplySearchPath] = useState(true);
  const [sourceClass, setSourceClass] = useState('');
  const [supplyClass, setSupplyClass] = useState(false);
  const [className, setClassName] = useState('');
  const [supplyClassName, setSupplyClassName] = useState(false);
  const [supplySaved, setSupplySaved] = useState(true);
  const [seedExpanded, setSeedExpanded] = useState<Flag>('omit');
  const [seedSearch, setSeedSearch] = useState<Flag>('omit');
  const [seedOverride, setSeedOverride] = useState<NonNullable<Saved['override']> | 'omit'>('omit');
  const [owners, setOwners] = useState<{ id: number; value: Saved }[]>([{ id: 1, value: {} }]);
  const [savedSnapshots, setSavedSnapshots] = useState<{ id: number; value: Saved }[]>([]);
  const owner = owners[owners.length - 1];
  const frame = useRef<HTMLElement | null>(null);
  const [dom, setDom] = useState<Observation | null>(null);
  const { attachFrame, record, describe, eventSnapshot } = observations;
  const onChildAction = useCallback(
    (event: MouseEvent) => {
      record({ kind: 'child-button', label, callbackRevision, event: eventSnapshot(event) });
    },
    [label, callbackRevision, record, eventSnapshot],
  );
  const onFinishStream = useCallback(
    (event: MouseEvent) => {
      record({ kind: 'finish-stream', label, callbackRevision, event: eventSnapshot(event) });
      setValues((current) => ({ ...current, isStreaming: 'false' }));
    },
    [label, callbackRevision, record, eventSnapshot],
  );
  const frameRef = useCallback(
    (node: HTMLElement | null) => {
      frame.current = node;
      if (!node) return;
      const release = attachFrame(node);
      return () => {
        release();
        frame.current = null;
      };
    },
    [attachFrame],
  );
  const blocks = rawBlocks(mode, text);
  const booleanProps = Object.fromEntries(
    groupFlags.flatMap((key) => (values[key] === 'omit' ? [] : [[key, values[key] === 'true']])),
  );

  function search(expand: boolean, restoreImmediately = false) {
    const target = frame.current?.querySelector('[data-chat-search-disclosure-id]');
    if (!target) {
      record({ kind: 'search-target-absent', label });
      return;
    }
    requestSearchDisclosure(target, expand);
    if (restoreImmediately) requestSearchDisclosure(target, false);
    record({ kind: 'search-request', label, expand, restoreImmediately, target: describe(target) });
  }

  function refresh() {
    setSavedSnapshots(owners.map((entry) => ({ id: entry.id, value: { ...entry.value } })));
    const node = frame.current;
    setDom({
      frame: describe(node),
      activeElement: describe(node?.ownerDocument.activeElement ?? null),
      triggers: Array.from(
        node?.querySelectorAll('[data-testid="response-group-disclosure"]') ?? [],
      ).map((trigger) => ({
        node: describe(trigger),
        expanded: trigger.getAttribute('aria-expanded'),
        controls: trigger.getAttribute('aria-controls'),
      })),
      children: Array.from(node?.querySelectorAll('[data-response-group-child]') ?? []).map(
        (child) => ({
          node: describe(child),
          inertAncestor: describe(child.closest('[inert]')),
          hiddenAncestor: describe(child.closest('[aria-hidden="true"]')),
          inputValue: child.querySelector('input')?.value,
        }),
      ),
    });
  }

  const controls = (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3">
      <legend>{label} inputs</legend>
      <TextField label={`${label} name`} value={name} onChange={setName} />
      {groupFlags.map((key) => (
        <Choice
          key={key}
          label={`${label} ${key}`}
          value={values[key]}
          options={flags}
          onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
        />
      ))}
      <NumberField
        label={`${label} headerHeight`}
        value={headerHeight}
        onChange={setHeaderHeight}
      />
      <Choice label={`${label} blocks`} value={mode} options={blockModes} onChange={setMode} />
      <TextField label={`${label} raw text`} value={text} onChange={setText} multiline />
      <Toggle
        label={`${label} supply searchPath`}
        value={supplySearchPath}
        onChange={setSupplySearchPath}
      />
      <TextField label={`${label} searchPath`} value={searchPath} onChange={setSearchPath} />
      <Toggle label={`${label} supply class`} value={supplyClass} onChange={setSupplyClass} />
      <TextField label={`${label} class`} value={sourceClass} onChange={setSourceClass} />
      <Toggle
        label={`${label} supply className`}
        value={supplyClassName}
        onChange={setSupplyClassName}
      />
      <TextField label={`${label} className`} value={className} onChange={setClassName} />
      <Toggle label={`Mount ${label}`} value={mounted} onChange={setMounted} />
      <Toggle label={`${label} supply saved owner`} value={supplySaved} onChange={setSupplySaved} />
      <Choice
        label={`${label} initial saved expanded`}
        value={seedExpanded}
        options={flags}
        onChange={setSeedExpanded}
      />
      <Choice
        label={`${label} initial saved searchOwnsExpansion`}
        value={seedSearch}
        options={flags}
        onChange={setSeedSearch}
      />
      <Choice
        label={`${label} initial saved override`}
        value={seedOverride}
        options={['omit', 'automatic', 'expanded-live', 'expanded-completed', 'collapsed']}
        onChange={setSeedOverride}
      />
      <p className="text-muted-foreground">
        Initial values apply on owner replacement. Replacement keeps the mounted group intact;
        remount reads the current owner. Snapshots read actual source writes to the last eight
        owners.
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const value: Saved = {
              ...(seedExpanded === 'omit' ? {} : { expanded: seedExpanded === 'true' }),
              ...(seedSearch === 'omit' ? {} : { searchOwnsExpansion: seedSearch === 'true' }),
              ...(seedOverride === 'omit' ? {} : { override: seedOverride }),
            };
            setOwners((current) => [
              ...current.slice(-7),
              { id: current[current.length - 1].id + 1, value },
            ]);
          }}
        >
          Replace {label} saved owner
        </Button>
        <Button variant="outline" onClick={() => setRevision((current) => current + 1)}>
          Remount {label}
        </Button>
        <Button variant="outline" onClick={() => setChildKey((current) => current + 1)}>
          Replace {label} child key
        </Button>
        <Button variant="outline" onClick={() => setCallbackRevision((current) => current + 1)}>
          Replace {label} child callback
        </Button>
        <Button
          variant="outline"
          onClick={() => setLines((current) => Math.min(120, current + 12))}
        >
          Grow {label} content
        </Button>
        <Button variant="outline" onClick={() => setLines(6)}>
          Reset {label} content
        </Button>
        <Button variant="outline" onClick={() => search(true)}>
          {label} search expand
        </Button>
        <Button variant="outline" onClick={() => search(false)}>
          {label} search restore
        </Button>
        <Button variant="outline" onClick={() => search(true, true)}>
          {label} search expand and restore
        </Button>
        <Button variant="outline" onClick={refresh}>
          Read {label} observations
        </Button>
      </div>
      <Output
        label={`${label} caller inputs`}
        value={{
          name,
          values,
          headerHeight,
          mode,
          text,
          lines,
          mounted,
          revision,
          childKey,
          callbackRevision,
          searchPath,
          supplySearchPath,
          sourceClass,
          supplyClass,
          className,
          supplyClassName,
          currentOwnerId: owner.id,
          supplySaved,
        }}
      />
      <Output label={`${label} saved snapshots`} value={savedSnapshots} />
      <Output label={`${label} DOM observations`} value={dom} />
    </fieldset>
  );
  const content = (
    <section
      ref={frameRef}
      data-testid={`response-${label.toLowerCase()}-frame`}
      aria-label={`${label} response group`}
      className="min-w-0 max-w-full"
    >
      {mounted && (
        <ResponseGroup
          key={revision}
          name={name}
          {...booleanProps}
          headerHeight={optionalNumber(headerHeight)}
          blocks={blocks}
          {...(supplySaved ? { saved: owner.value } : {})}
          {...(supplySearchPath ? { searchPath } : {})}
          {...(supplyClass ? { class: sourceClass } : {})}
          {...(supplyClassName ? { className } : {})}
        >
          <ExerciseChildren
            key={childKey}
            label={label}
            blocks={blocks}
            lines={lines}
            text={text}
            observations={observations}
            onAction={onChildAction}
            onFinishStream={onFinishStream}
          />
        </ResponseGroup>
      )}
    </section>
  );
  return { controls, content };
}

function FollowedGroups({
  children,
  observations,
}: {
  children: ReactNode;
  observations: Observations;
}) {
  const [enabled, setEnabled] = useState(true);
  const { record, attachFrame } = observations;
  const viewportRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const release = attachFrame(node);
      // Existing canonical consumer; it alone owns listeners, measurements and mutation leases.
      const follower = enabled
        ? followBottom(node, {
            follow: true,
            layoutNeutralBottomAnchor: true,
            onFollowChange: (value) => record({ kind: 'follow-callback', value }),
            onScrollStateChange: (value) => record({ kind: 'follow-geometry', ...value }),
          })
        : null;
      return () => {
        follower?.destroy();
        release();
      };
    },
    [enabled, record, attachFrame],
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <Toggle label="Attach canonical group follower" value={enabled} onChange={setEnabled} />
      <p className="text-muted-foreground">
        Use the sandbox motion setting for reduced or full motion.
      </p>
      <section
        ref={viewportRef}
        aria-label="Response groups scroll viewport"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This real scroll viewport needs native keyboard access.
        tabIndex={0}
        data-testid="response-groups-scroll"
        className="h-80 min-w-0 max-w-full overflow-y-auto"
      >
        <div className="grid min-w-0 grid-cols-1 gap-3">
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index}>Earlier caller paragraph {index + 1}</p>
          ))}
          {children}
        </div>
      </section>
    </div>
  );
}

function CylinderExercise({ observations }: { observations: Observations }) {
  const [isActive, setIsActive] = useState<Flag>('omit');
  const [constrained, setConstrained] = useState<Flag>('omit');
  const [maxHeight, setMaxHeight] = useState('');
  const [fadeTop, setFadeTop] = useState('');
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [childKey, setChildKey] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [lines, setLines] = useState(24);
  const [text, setText] = useState(
    'Native scrolling and editable children stay in this real cylinder.',
  );
  const frame = useRef<HTMLElement | null>(null);
  const [dom, setDom] = useState<Observation | null>(null);
  const { attachFrame, describe, record, eventSnapshot } = observations;
  const onChildAction = useCallback(
    (event: MouseEvent) => {
      record({
        kind: 'child-button',
        label: 'Cylinder',
        callbackRevision,
        event: eventSnapshot(event),
      });
    },
    [callbackRevision, record, eventSnapshot],
  );
  const frameRef = useCallback(
    (node: HTMLElement | null) => {
      frame.current = node;
      if (!node) return;
      const release = attachFrame(node);
      return () => {
        release();
        frame.current = null;
      };
    },
    [attachFrame],
  );
  return (
    <section aria-label="Cylinder exercise" className="grid min-w-0 grid-cols-1 gap-3">
      <h3>Cylinder scrolling</h3>
      <Choice label="Cylinder isActive" value={isActive} options={flags} onChange={setIsActive} />
      <Choice
        label="Cylinder constrained"
        value={constrained}
        options={flags}
        onChange={setConstrained}
      />
      <NumberField label="Cylinder maxHeight" value={maxHeight} onChange={setMaxHeight} />
      <NumberField label="Cylinder fadeTop" value={fadeTop} onChange={setFadeTop} />
      <TextField label="Cylinder raw text" value={text} onChange={setText} multiline />
      <Toggle label="Mount Cylinder" value={mounted} onChange={setMounted} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setLines((current) => Math.min(120, current + 12))}
        >
          Grow Cylinder content
        </Button>
        <Button variant="outline" onClick={() => setLines(24)}>
          Reset Cylinder content
        </Button>
        <Button variant="outline" onClick={() => setRevision((current) => current + 1)}>
          Remount Cylinder
        </Button>
        <Button variant="outline" onClick={() => setChildKey((current) => current + 1)}>
          Replace Cylinder child key
        </Button>
        <Button variant="outline" onClick={() => setCallbackRevision((current) => current + 1)}>
          Replace Cylinder child callback
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const node = frame.current?.querySelector<HTMLElement>('.cylinder-scroller');
            setDom({
              node: describe(node ?? null),
              activeElement: describe(frame.current?.ownerDocument.activeElement ?? null),
              ...(node
                ? {
                    scrollTop: node.scrollTop,
                    scrollHeight: node.scrollHeight,
                    clientHeight: node.clientHeight,
                    tabIndex: node.tabIndex,
                  }
                : {}),
            });
          }}
        >
          Read Cylinder observations
        </Button>
      </div>
      <section
        ref={frameRef}
        data-testid="response-cylinder-frame"
        aria-label="Independent cylinder"
        className="min-w-0 max-w-full"
      >
        {mounted && (
          <CylinderScroller
            key={revision}
            maxHeight={optionalNumber(maxHeight)}
            fadeTop={optionalNumber(fadeTop)}
            {...(isActive === 'omit' ? {} : { isActive: isActive === 'true' })}
            {...(constrained === 'omit' ? {} : { constrained: constrained === 'true' })}
          >
            <ExerciseChildren
              key={childKey}
              label="Cylinder"
              lines={lines}
              text={text}
              observations={observations}
              onAction={onChildAction}
              controlsAtBottom
            />
          </CylinderScroller>
        )}
      </section>
      <Output
        label="Cylinder caller inputs"
        value={{
          isActive,
          constrained,
          maxHeight,
          fadeTop,
          mounted,
          revision,
          childKey,
          callbackRevision,
          lines,
          text,
        }}
      />
      <Output label="Cylinder DOM observations" value={dom} />
    </section>
  );
}

export function ResponseGroupExamples() {
  const observations = useObservations();
  const primary = useGroupExercise('Primary', observations);
  const neighbor = useGroupExercise('Neighbor', observations);
  const readyRef = useCallback((node: HTMLElement | null) => {
    if (node) node.dataset.exampleReady = 'true';
  }, []);
  return (
    <section
      ref={readyRef}
      aria-label="Response group exercises"
      data-functional-example="response-group"
      className="grid min-w-0 max-w-full grid-cols-1 gap-6"
    >
      <h2>Response groups and cylinder scrolling</h2>
      <p className="text-muted-foreground">
        These controls supply caller inputs to the actual components. Native wheel, keyboard and
        child editing exercise their own behavior. Read observations after the interaction.
      </p>
      {primary.controls}
      {neighbor.controls}
      <FollowedGroups observations={observations}>
        {primary.content}
        {neighbor.content}
      </FollowedGroups>
      <CylinderExercise observations={observations} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" onClick={observations.refresh}>
          Read response event receipts
        </Button>
        <Button variant="outline" onClick={observations.clear}>
          Clear response event receipts
        </Button>
      </div>
      <Output label="Response event receipts" value={observations.snapshot} />
    </section>
  );
}
