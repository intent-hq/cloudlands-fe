// i18n-ignore (internal, unreleased catalog inputs and caller observations)
import { useCallback, useRef, useState } from 'react';
import type { MarkdownViewerProps } from '@/components/markdown/markdown-viewer';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ThinkingBlock, type ThinkingBlockProps } from '@/features/chat/components/thinking-block';
import { ReasoningHistoryBlock } from '@/features/chat/components/reasoning-history-block';
import { requestSearchDisclosure } from '$lib/components/chat/chat-search-disclosure';
import { WorkspaceId } from '$shared/types/branded-ids';

// Raw parser inputs only. The actual leaves own extraction and disclosure state.
const samples = {
  heading: '## **Check** `schema` with [label](https://example.com)\n\nBody paragraph.',
  headingless: 'Let me check the schema',
  short: 'Considering task restoration\n\nCheck the saved task state before continuing.',
  setext: '\r\n**Restore** task\r\n---\r\n\r\nRestore task\r\n',
  standalone: '**Preparing task plan**\n\n**Checking duplicate tracker issue**',
  history:
    '**Preparing task plan**\n\n**Checking duplicate tracker issue**\n\nThe supplied paragraph stays readable.\n\nA second paragraph stays in order.',
  inline: '**Checking `src/*.ts` &amp; _private**\n\n  Body with `src/*.ts`, _private and &amp;.\n',
  fragments: '**I** will inspect **schema**',
  empty: '',
  links:
    '# Navigation inputs\n\n[Web link](https://example.com/reasoning)\n\n[File link](intent://local/file/docs/report%20%231.pdf#L8)\n\n[Note link](intent://local/note/spec)\n\nFile mention: @src/a.ts:10\n\nNote mention: @note/spec',
};
type Flag = 'omit' | 'true' | 'false';
type Saved = NonNullable<ThinkingBlockProps['saved']>;
type Observation = Record<string, unknown>;
const flags = ['omit', 'true', 'false'] as const;
const commonFlags = ['isStreaming', 'allowFileMedia', 'adjacentOperationalRow'] as const;

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
            rows={5}
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
          className="min-w-0 flex-wrap justify-start"
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

function Output({ label, value }: { label: string; value: unknown }) {
  return (
    <output
      aria-label={label}
      className="block min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(
        value,
        (_key, entry) =>
          typeof entry === 'function' ? '[function]' : entry === undefined ? '[undefined]' : entry,
        2,
      )}
    </output>
  );
}

function describeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    rawHref: target.closest('a')?.getAttribute('href') ?? null,
    panelId: target.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
  };
}

// Observation only: callbacks may run during child render, so writes stay in refs
// until the caller explicitly refreshes. Native listeners never alter the event.
function useReceipts() {
  const records = useRef({ callbacks: [] as Observation[], native: [] as Observation[] });
  const nativeEvents = useRef<Event[]>([]);
  const captured = useRef<Event | null>(null);
  const identities = useRef({ next: 0, objects: new WeakMap<object, number>() });
  const [observations, setObservations] = useState({
    revision: 0,
    callbacks: [] as Observation[],
    native: [] as Observation[],
  });
  const objectId = useCallback((object: object) => {
    const registry = identities.current;
    let id = registry.objects.get(object);
    if (id === undefined) {
      id = ++registry.next;
      registry.objects.set(object, id);
    }
    return id;
  }, []);
  const snapshotEvent = useCallback(
    (event: Event) => ({
      objectId: objectId(event),
      type: event.type,
      isTrusted: event.isTrusted,
      target: describeTarget(event.target),
      currentTarget: describeTarget(event.currentTarget),
      eventPhase: event.eventPhase,
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      sameAsCapturedEvent: captured.current === event,
      ...(event instanceof MouseEvent
        ? { button: event.button, buttons: event.buttons, detail: event.detail }
        : {}),
      ...(event instanceof KeyboardEvent
        ? { key: event.key, code: event.code, repeat: event.repeat }
        : {}),
      ...(event instanceof MouseEvent || event instanceof KeyboardEvent
        ? {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          }
        : {}),
    }),
    [objectId],
  );
  const record = useCallback(
    (name: string, revision: number, args: unknown[], result?: boolean) => {
      function argument(value: unknown): unknown {
        if (value instanceof Event) return snapshotEvent(value);
        if (typeof value === 'function') return { type: 'function', objectId: objectId(value) };
        if (Array.isArray(value)) return value.map(argument);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, argument(entry)]),
          );
        return value;
      }
      records.current.callbacks = [
        ...records.current.callbacks.slice(-29),
        {
          name,
          callbackRevision: revision,
          argumentCount: args.length,
          arguments: args.map(argument),
          result,
          capturedEvent:
            name !== 'canOpenFile' && captured.current ? snapshotEvent(captured.current) : null,
        },
      ];
    },
    [objectId, snapshotEvent],
  );
  const frame = useRef<HTMLDivElement | null>(null);
  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      frame.current = node;
      if (!node) return;
      const cleanup = ['click', 'pointerdown', 'keydown', 'keyup', 'focusin'].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            if (capture) {
              captured.current = event;
              nativeEvents.current = [...nativeEvents.current.slice(-19), event];
            }
            records.current.native = [
              ...records.current.native.slice(-39),
              {
                phase: capture ? 'capture' : 'bubble',
                ...snapshotEvent(event),
              },
            ];
          };
          node.addEventListener(type, listener, { capture, passive: true });
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => {
        cleanup.forEach((release) => release());
        frame.current = null;
        captured.current = null;
      };
    },
    [snapshotEvent],
  );
  return {
    frame,
    frameRef,
    record,
    observations,
    refresh: () => {
      // Refresh happens after the original dispatch, including React's delegated handlers.
      // Read the retained Event itself; never predict prevention or schedule test events.
      const next = {
        callbacks: records.current.callbacks,
        native: [
          ...records.current.native,
          ...nativeEvents.current.map((event) => ({ phase: 'settled', ...snapshotEvent(event) })),
        ],
      };
      setObservations((current) => ({ revision: current.revision + 1, ...next }));
    },
    clear: () => {
      records.current = { callbacks: [], native: [] };
      nativeEvents.current = [];
      captured.current = null;
      setObservations((current) => ({ revision: current.revision + 1, ...records.current }));
    },
  };
}

function ReasoningExercise({ kind }: { kind: 'thinking' | 'history' }) {
  const thinking = kind === 'thinking';
  const name = thinking ? 'Thinking' : 'History';
  const [content, setContent] = useState<string>(thinking ? samples.heading : samples.history);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [width, setWidth] = useState<'420' | '720'>('720');
  const [values, setValues] = useState<Record<(typeof commonFlags)[number], Flag>>({
    isStreaming: 'omit',
    allowFileMedia: 'omit',
    adjacentOperationalRow: 'omit',
  });
  const [autoExpand, setAutoExpand] = useState<Flag>('omit');
  const [searchPath, setSearchPath] = useState('b:1:c:0');
  const [supplySearchPath, setSupplySearchPath] = useState(true);
  const [sourceClass, setSourceClass] = useState('');
  const [supplyClass, setSupplyClass] = useState(false);
  const [className, setClassName] = useState('');
  const [supplyClassName, setSupplyClassName] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('reasoning-workspace-a');
  const [supplyWorkspace, setSupplyWorkspace] = useState(true);
  const [contextMode, setContextMode] = useState<'omit' | 'null' | 'workspace'>('omit');
  const [contextWorkspace, setContextWorkspace] = useState('reasoning-context-a');
  const [panelId, setPanelId] = useState(`reasoning-${kind}-panel`);
  const [canOpen, setCanOpen] = useState<Flag>('omit');
  const [linkResult, setLinkResult] = useState(true);
  const [supplySaved, setSupplySaved] = useState(true);
  const [initialFlags, setInitialFlags] = useState<Record<keyof Saved, Flag>>({
    expanded: 'omit',
    userToggled: 'omit',
    searchOwnsExpansion: 'omit',
  });
  const [savedObjects, setSavedObjects] = useState<{ id: number; value: Saved }[]>([
    { id: 1, value: {} },
  ]);
  const saved = savedObjects[savedObjects.length - 1];
  const [savedSnapshots, setSavedSnapshots] = useState<{ id: number; value: Saved }[]>([]);
  const [itemMode, setItemMode] = useState(false);
  const [itemTitle, setItemTitle] = useState('Override title');
  const [itemNullTitle, setItemNullTitle] = useState(false);
  const [itemBody, setItemBody] = useState('The actual override body.');
  const [searchRequests, setSearchRequests] = useState<Observation[]>([]);
  const { frame, frameRef, record, observations, refresh, clear } = useReceipts();
  const canOpenFile = useCallback(() => {
    const result = canOpen === 'true';
    record('canOpenFile', callbackRevision, [], result);
    return result;
  }, [canOpen, callbackRevision, record]);
  const onOpenLink = useCallback<MarkdownViewerProps['onOpenLink']>(
    (...args) => {
      record('onOpenLink', callbackRevision, args, linkResult);
      return linkResult;
    },
    [callbackRevision, linkResult, record],
  );
  const onOpenFile = useCallback<MarkdownViewerProps['onOpenFile']>(
    (...args) => {
      record('onOpenFile', callbackRevision, args);
    },
    [callbackRevision, record],
  );
  const onOpenNote = useCallback<MarkdownViewerProps['onOpenNote']>(
    (...args) => {
      record('onOpenNote', callbackRevision, args);
    },
    [callbackRevision, record],
  );
  const viewerProps = {
    content,
    ...(values.isStreaming === 'omit' ? {} : { isStreaming: values.isStreaming === 'true' }),
    ...(values.allowFileMedia === 'omit'
      ? {}
      : { allowFileMedia: values.allowFileMedia === 'true' }),
    ...(values.adjacentOperationalRow === 'omit'
      ? {}
      : { adjacentOperationalRow: values.adjacentOperationalRow === 'true' }),
    ...(supplyWorkspace ? { workspaceId } : {}),
    ...(canOpen === 'omit' ? {} : { canOpenFile }),
    workspaceContext:
      contextMode === 'omit'
        ? undefined
        : {
            workspaceId: contextMode === 'null' ? null : WorkspaceId(contextWorkspace),
          },
    onOpenLink,
    onOpenFile,
    onOpenNote,
  };
  const thinkingProps = {
    ...(supplySaved ? { saved: saved.value } : {}),
    ...(supplySearchPath ? { searchPath } : {}),
    ...(autoExpand === 'omit' ? {} : { autoExpandWhileStreaming: autoExpand === 'true' }),
    ...(supplyClass ? { class: sourceClass } : {}),
    ...(supplyClassName ? { className } : {}),
  };
  const historyProps = itemMode
    ? { item: { title: itemNullTitle ? null : itemTitle, body: itemBody } }
    : {};

  function search(expand: boolean, restoreImmediately = false) {
    const target = frame.current?.querySelector('[data-chat-search-disclosure-id]');
    if (target) {
      requestSearchDisclosure(target, expand);
      if (restoreImmediately) requestSearchDisclosure(target, false);
    }
    setSearchRequests((current) => [
      ...current.slice(-9),
      {
        request: restoreImmediately ? 'expand-and-restore' : expand ? 'expand' : 'restore',
        targetId: target?.getAttribute('data-chat-search-disclosure-id') ?? null,
      },
    ]);
  }

  return (
    <section
      aria-label={`${name} exercise`}
      data-testid={`reasoning-${kind}`}
      className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4"
    >
      <h3>{name}</h3>
      <p className="text-muted-foreground">
        Inputs update the mounted component. Only the remount button changes its identity.
      </p>
      <div className="flex min-w-0 flex-wrap gap-2">
        {Object.entries(samples).map(([label, raw]) => (
          <Button key={label} variant="outline" size="sm" onClick={() => setContent(raw)}>
            Load {label}
          </Button>
        ))}
      </div>
      <TextField label={`${name} raw content`} value={content} onChange={setContent} multiline />
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        {commonFlags.map((key) => (
          <Choice
            key={key}
            label={`${name} ${key}`}
            value={values[key]}
            options={flags}
            onChange={(value) => setValues((current) => ({ ...current, [key]: value }))}
          />
        ))}
        <Choice
          label={`${name} frame width`}
          value={width}
          options={['420', '720']}
          onChange={setWidth}
        />
        <Toggle label={`Mount ${name}`} value={mounted} onChange={setMounted} />
      </div>
      {thinking ? (
        <>
          <Choice
            label="Thinking autoExpandWhileStreaming"
            value={autoExpand}
            options={flags}
            onChange={setAutoExpand}
          />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <Toggle
              label="Supply searchPath"
              value={supplySearchPath}
              onChange={setSupplySearchPath}
            />
            <TextField label="Thinking searchPath" value={searchPath} onChange={setSearchPath} />
            <Toggle label="Supply class" value={supplyClass} onChange={setSupplyClass} />
            <TextField label="Thinking class" value={sourceClass} onChange={setSourceClass} />
            <Toggle
              label="Supply className"
              value={supplyClassName}
              onChange={setSupplyClassName}
            />
            <TextField label="Thinking className" value={className} onChange={setClassName} />
          </div>
          <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
            <legend>Caller saved object</legend>
            <p>
              Initial flags apply only when replacing the caller object. Replacement leaves the
              mounted row intact; remount reads that same object again. Refresh reads actual writes,
              including previous objects.
            </p>
            <Toggle label="Supply saved object" value={supplySaved} onChange={setSupplySaved} />
            {(Object.keys(initialFlags) as (keyof Saved)[]).map((key) => (
              <Choice
                key={key}
                label={`Initial saved ${key}`}
                value={initialFlags[key]}
                options={flags}
                onChange={(value) => setInitialFlags((current) => ({ ...current, [key]: value }))}
              />
            ))}
            <div className="flex min-w-0 flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const value: Saved = {};
                  for (const key of Object.keys(initialFlags) as (keyof Saved)[]) {
                    if (initialFlags[key] !== 'omit') value[key] = initialFlags[key] === 'true';
                  }
                  setSavedObjects((current) => [...current, { id: current.length + 1, value }]);
                }}
              >
                Replace saved object
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  setSavedSnapshots(
                    savedObjects.map((entry) => ({
                      id: entry.id,
                      value: { ...entry.value },
                    })),
                  )
                }
              >
                Refresh saved snapshots
              </Button>
            </div>
            <Output
              label="Thinking saved snapshots"
              value={{ currentId: saved.id, supplied: supplySaved, snapshots: savedSnapshots }}
            />
          </fieldset>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => search(true)}>
              Search expand
            </Button>
            <Button variant="outline" onClick={() => search(false)}>
              Search restore
            </Button>
            <Button variant="outline" onClick={() => search(true, true)}>
              Search expand and restore
            </Button>
          </div>
          <Output label="Thinking search requests" value={searchRequests} />
        </>
      ) : (
        <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          <legend>History item override</legend>
          <Toggle label="Supply history item" value={itemMode} onChange={setItemMode} />
          <Toggle
            label="History item title is null"
            value={itemNullTitle}
            onChange={setItemNullTitle}
          />
          <TextField label="History item title" value={itemTitle} onChange={setItemTitle} />
          <TextField label="History item body" value={itemBody} onChange={setItemBody} multiline />
        </fieldset>
      )}
      <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <legend>{name} Markdown host inputs</legend>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
          <Toggle
            label={`${name} supply workspaceId`}
            value={supplyWorkspace}
            onChange={setSupplyWorkspace}
          />
          <TextField label={`${name} workspaceId`} value={workspaceId} onChange={setWorkspaceId} />
          <Choice
            label={`${name} workspace context`}
            value={contextMode}
            options={['omit', 'null', 'workspace']}
            onChange={setContextMode}
          />
          <TextField
            label={`${name} context workspaceId`}
            value={contextWorkspace}
            onChange={setContextWorkspace}
          />
          <TextField label={`${name} source panelId`} value={panelId} onChange={setPanelId} />
          <Choice
            label={`${name} canOpenFile`}
            value={canOpen}
            options={flags}
            onChange={setCanOpen}
          />
          <Toggle label={`${name} onOpenLink result`} value={linkResult} onChange={setLinkResult} />
        </div>
        <p className="text-muted-foreground">
          Callbacks record current arguments and native events without opening files, notes, or
          links. Refresh observations after interacting with the component.
        </p>
      </fieldset>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!mounted}
          onClick={() => setMountRevision((value) => value + 1)}
        >
          Remount {name}
        </Button>
        <Button variant="outline" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace {name} callbacks
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh {name} observations
        </Button>
        <Button variant="outline" onClick={clear}>
          Clear {name} observations
        </Button>
      </div>
      <div
        ref={frameRef}
        data-testid={`reasoning-${kind}-frame`}
        data-panel-id={panelId}
        className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)]"
        style={{ width: `min(100%, ${width}px)` }}
      >
        {mounted &&
          (thinking ? (
            <ThinkingBlock key={mountRevision} {...viewerProps} {...thinkingProps} />
          ) : (
            <ReasoningHistoryBlock key={mountRevision} {...viewerProps} {...historyProps} />
          ))}
      </div>
      <Output
        label={`${name} current inputs`}
        value={{
          mounted,
          mountRevision,
          callbackRevision,
          width,
          props: {
            ...viewerProps,
            ...(thinking
              ? { ...thinkingProps, saved: supplySaved ? { objectId: saved.id } : undefined }
              : historyProps),
          },
          host: { panelId, canOpen, linkResult },
        }}
      />
      <Output label={`${name} observations`} value={observations} />
    </section>
  );
}

export function ReasoningExamples() {
  return (
    <section
      data-functional-example="reasoning"
      aria-label="Reasoning examples"
      className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-8"
    >
      <h2>Thinking and reasoning history</h2>
      <ReasoningExercise kind="thinking" />
      <ReasoningExercise kind="history" />
    </section>
  );
}
