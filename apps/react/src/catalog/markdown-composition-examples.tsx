// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  MediaUnavailable,
  type MediaUnavailableProps,
  type MediaUnavailableReason,
} from '@/components/ui/media-unavailable';
import { MarkdownDiagram, type MarkdownDiagramProps } from '@/components/markdown/markdown-diagram';
import {
  CUSTOM_WORKBENCH_CASES,
  MERMAID_WORKBENCH_CASES,
} from '$lib/components/diagrams/diagram-workbench.preview-fixtures';

// Raw input only. MarkdownDiagram owns serialization, validation and rendering.
// Both targets are local references; the host records navigation requests only.
const bindingSource = `{
  "id": "a3ff33fe-f02b-4a7d-a3d9-d158c50b8432",
  "type": "diagram",
  "version": 1,
  "createdAt": "2026-10-12T00:00:00.000Z",
  "createdBy": "agent",
  "grammar": "flowchart",
  "model": {
    "nodes": [
      { "id": "file", "label": "Local file", "binding": { "type": "file", "target": "apps/react/src/catalog/markdown-composition-examples.tsx" } },
      { "id": "note", "label": "Local note", "binding": { "type": "note", "target": "spec" } },
      { "id": "empty", "label": "Empty target", "binding": { "type": "file", "target": "" } },
      { "id": "symbol", "label": "Symbol binding", "binding": { "type": "symbol", "target": "MarkdownCompositionExamples" } }
    ],
    "edges": [
      { "id": "file-note", "from": "file", "to": "note" },
      { "id": "note-empty", "from": "note", "to": "empty" },
      { "id": "empty-symbol", "from": "empty", "to": "symbol" }
    ]
  },
  "baseView": { "layout": { "type": "layered", "direction": "TB" } }
}`;

const sources = {
  bindings: { kind: 'diagram', source: bindingSource },
  architecture: {
    kind: 'diagram',
    source: JSON.stringify(CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram, null, 2),
  },
  'partial-json': { kind: 'diagram', source: bindingSource.slice(0, -2) },
  'invalid-json': { kind: 'diagram', source: '{ "model": invalid }' },
  'mermaid-valid': {
    kind: 'mermaid',
    source: MERMAID_WORKBENCH_CASES['mermaid-two-node'].source,
  },
  'mermaid-error': {
    kind: 'mermaid',
    source: MERMAID_WORKBENCH_CASES['mermaid-invalid-source'].source,
  },
  empty: { kind: 'diagram', source: '' },
} satisfies Record<string, Pick<MarkdownDiagramProps, 'kind' | 'source'>>;
type SourceName = keyof typeof sources;
type CallbackName = 'onOpenLink' | 'onOpenFile';
type Observation = Record<string, unknown>;

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Input
          {...field}
          data-testid={id}
          value={value}
          maxLength={2048}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    />
  );
}

function BooleanField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch
          {...field}
          ariaLabel={label}
          data-testid={id}
          checked={value}
          onCheckedChange={onChange}
        />
      )}
    />
  );
}

function ChoiceField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
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
          data-testid={id}
          value={value}
          className="min-w-0 flex-wrap justify-start"
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option} data-testid={`${id}-${option}`}>
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

function Output({ id, label, value }: { id: string; label: string; value: unknown }) {
  return (
    <output
      data-testid={id}
      aria-label={label}
      className="block min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere"
    >
      {JSON.stringify(value, (_key, entry) => (entry === undefined ? '[undefined]' : entry), 2)}
    </output>
  );
}

function describeElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return {
    tag: target.tagName,
    id: target.id,
    testId: target.getAttribute('data-testid'),
    nearestTestId: target.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
    panelId: target.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
  };
}

function useExercise() {
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [width, setWidth] = useState('420');
  const [revisions, setRevisions] = useState({ onOpenLink: 0, onOpenFile: 0 });
  const [observations, setObservations] = useState<{
    counts: Record<string, number>;
    callbacks: Observation[];
    native: Observation[];
  }>({ counts: {}, callbacks: [], native: [] });
  const identities = useRef({ next: 0, ids: new WeakMap<Event, number>() });
  const capturedClick = useRef<MouseEvent | null>(null);

  const snapshot = useCallback((event: Event) => {
    let objectId = identities.current.ids.get(event);
    if (objectId === undefined) {
      objectId = ++identities.current.next;
      identities.current.ids.set(event, objectId);
    }
    return {
      objectId,
      type: event.type,
      isTrusted: event.isTrusted,
      currentTarget: describeElement(event.currentTarget),
      target: describeElement(event.target),
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      eventPhase: event.eventPhase,
      sameAsCapturedClick: event === capturedClick.current,
      ...(event instanceof MouseEvent
        ? {
            detail: event.detail,
            button: event.button,
            buttons: event.buttons,
          }
        : {}),
      ...(event instanceof MouseEvent || event instanceof KeyboardEvent
        ? {
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          }
        : {}),
      ...(event instanceof KeyboardEvent ? { key: event.key, code: event.code } : {}),
    };
  }, []);

  const record = useCallback(
    (name: string, revision: number, args: unknown[], result?: boolean) => {
      function snapshotArgument(argument: unknown): unknown {
        if (argument instanceof Event) return snapshot(argument);
        if (Array.isArray(argument)) return argument.map(snapshotArgument);
        if (argument && typeof argument === 'object') {
          return Object.fromEntries(
            Object.entries(argument).map(([key, value]) => [key, snapshotArgument(value)]),
          );
        }
        return argument;
      }
      // Snapshot now, including wrapped options.event: native currentTarget is transient.
      const observation = {
        name,
        callbackRevision: revision,
        mountRevision,
        argumentCount: args.length,
        arguments: args.map(snapshotArgument),
        result,
        capturedClick: capturedClick.current ? snapshot(capturedClick.current) : null,
      };
      setObservations((current) => ({
        ...current,
        counts: { ...current.counts, [name]: (current.counts[name] ?? 0) + 1 },
        callbacks: [...current.callbacks.slice(-11), observation],
      }));
    },
    [mountRevision, snapshot],
  );

  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const cleanups = ['click', 'dblclick', 'pointerdown', 'keydown', 'keyup'].flatMap((type) =>
        [true, false].map((capture) => {
          const listener = (event: Event) => {
            if (type === 'click' && capture && event instanceof MouseEvent) {
              capturedClick.current = event;
            }
            const name = `native-${type}-${capture ? 'capture' : 'bubble'}`;
            const observation = { name, ...snapshot(event) };
            setObservations((current) => ({
              ...current,
              counts: { ...current.counts, [name]: (current.counts[name] ?? 0) + 1 },
              native: [...current.native.slice(-19), observation],
            }));
          };
          node.addEventListener(type, listener, capture);
          return () => node.removeEventListener(type, listener, capture);
        }),
      );
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        capturedClick.current = null;
      };
    },
    [snapshot],
  );

  return {
    mounted,
    mountRevision,
    width,
    revisions,
    observations,
    record,
    frameRef,
    setWidth,
    setMounted: (value: boolean) => {
      setMounted(value);
      if (value) setMountRevision((revision) => revision + 1);
    },
    remount: () => setMountRevision((revision) => revision + 1),
    replace: (name: CallbackName) =>
      setRevisions((current) => ({
        ...current,
        [name]: current[name] + 1,
      })),
    clear: () => {
      capturedClick.current = null;
      setObservations({ counts: {}, callbacks: [], native: [] });
    },
  };
}
type Exercise = ReturnType<typeof useExercise>;

function ExerciseControls({
  id,
  exercise,
  callbacks,
}: {
  id: string;
  exercise: Exercise;
  callbacks: CallbackName[];
}) {
  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <BooleanField
          id={`${id}-mounted`}
          label={`${id} mounted`}
          value={exercise.mounted}
          onChange={exercise.setMounted}
        />
        <ChoiceField
          id={`${id}-width`}
          label={`${id} frame width`}
          value={exercise.width}
          options={['420', '720']}
          onChange={exercise.setWidth}
        />
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {callbacks.map((name) => (
          <Button
            key={name}
            data-testid={`${id}-replace-${name}`}
            onClick={() => exercise.replace(name)}
          >
            Replace {name}
          </Button>
        ))}
        <Button
          data-testid={`${id}-remount`}
          disabled={!exercise.mounted}
          onClick={exercise.remount}
        >
          Remount component
        </Button>
        <Button data-testid={`${id}-clear`} onClick={exercise.clear}>
          Clear observations
        </Button>
      </div>
    </>
  );
}

function Frame({
  id,
  exercise,
  children,
}: {
  id: string;
  exercise: Exercise;
  children: ReactNode;
}) {
  const { frameRef, width } = exercise;
  return (
    <div
      ref={frameRef}
      data-testid={`${id}-frame`}
      className="min-w-0 max-w-full"
      style={{ width: Number(width) }}
    >
      {children}
      <Button data-testid={`${id}-sibling`}>Unrelated sibling</Button>
    </div>
  );
}

function ExerciseOutputs({
  id,
  exercise,
  inputs,
}: {
  id: string;
  exercise: Exercise;
  inputs: unknown;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <Output
        id={`${id}-state`}
        label={`${id} caller inputs`}
        value={{
          mounted: exercise.mounted,
          mountRevision: exercise.mountRevision,
          width: exercise.width,
          callbackRevisions: exercise.revisions,
          inputs,
        }}
      />
      <Output
        id={`${id}-observations`}
        label={`${id} bounded observations`}
        value={exercise.observations}
      />
    </div>
  );
}

function MediaStatusExample() {
  const id = 'media-status';
  const exercise = useExercise();
  const [reason, setReason] = useState<MediaUnavailableReason>('missing');
  const [name, setName] = useState('Local media');
  const [path, setPath] = useState('apps/react/src/catalog/markdown-composition-examples.tsx');
  const [workspaceId, setWorkspaceId] = useState('system-design');
  const [omitName, setOmitName] = useState(false);
  const [omitPath, setOmitPath] = useState(false);
  const [omitWorkspace, setOmitWorkspace] = useState(false);
  const [pasted, setPasted] = useState('');
  const { record, revisions } = exercise;
  const onOpenLink = useCallback<MediaUnavailableProps['onOpenLink']>(
    (...args) => {
      record('onOpenLink', revisions.onOpenLink, args, true);
      return true;
    },
    [record, revisions.onOpenLink],
  );
  const props = {
    reason,
    ...(omitName ? {} : { name }),
    ...(omitPath ? {} : { path }),
    ...(omitWorkspace ? {} : { workspaceId }),
  };

  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      aria-label="Media status exercise"
      data-functional-example={id}
      data-testid={`${id}-section`}
    >
      <h2>Unavailable media</h2>
      <ChoiceField
        id={`${id}-reason`}
        label="Media reason"
        value={reason}
        options={['missing', 'unsupported', 'load-failed']}
        onChange={setReason}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <TextField id={`${id}-name`} label="Media name" value={name} onChange={setName} />
        <BooleanField
          id={`${id}-omit-name`}
          label="Omit media name"
          value={omitName}
          onChange={setOmitName}
        />
        <TextField id={`${id}-path`} label="Media path" value={path} onChange={setPath} />
        <BooleanField
          id={`${id}-omit-path`}
          label="Omit media path"
          value={omitPath}
          onChange={setOmitPath}
        />
        <TextField
          id={`${id}-workspace`}
          label="Media workspace"
          value={workspaceId}
          onChange={setWorkspaceId}
        />
        <BooleanField
          id={`${id}-omit-workspace`}
          label="Omit media workspace"
          value={omitWorkspace}
          onChange={setOmitWorkspace}
        />
      </div>
      <ExerciseControls id={id} exercise={exercise} callbacks={['onOpenLink']} />
      <Frame id={id} exercise={exercise}>
        {exercise.mounted && (
          <MediaUnavailable key={exercise.mountRevision} {...props} onOpenLink={onOpenLink} />
        )}
      </Frame>
      <FormField
        label="Paste copied path here"
        control={(field) => (
          <Input
            {...field}
            data-testid={`${id}-paste`}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            onPaste={(event) =>
              record('onPaste', 0, [event.clipboardData.getData('text/plain'), event.nativeEvent])
            }
          />
        )}
      />
      <Output id={`${id}-paste-value`} label="Actual paste target value" value={pasted} />
      <ExerciseOutputs id={id} exercise={exercise} inputs={props} />
    </section>
  );
}

function MarkdownDiagramExample() {
  const id = 'markdown-diagram';
  const exercise = useExercise();
  const [kind, setKind] = useState<MarkdownDiagramProps['kind']>('diagram');
  const [source, setSource] = useState(bindingSource);
  const [sourceName, setSourceName] = useState<SourceName>('bindings');
  const [workspaceId, setWorkspaceId] = useState('system-design');
  const [omitWorkspace, setOmitWorkspace] = useState(false);
  const [outerPanel, setOuterPanel] = useState('markdown-outer');
  const [innerPanel, setInnerPanel] = useState('markdown-inner');
  const [omitOuterPanel, setOmitOuterPanel] = useState(false);
  const [omitInnerPanel, setOmitInnerPanel] = useState(false);
  const { record, revisions } = exercise;
  const onOpenFile = useCallback<MarkdownDiagramProps['onOpenFile']>(
    (...args) => {
      record('onOpenFile', revisions.onOpenFile, args);
    },
    [record, revisions.onOpenFile],
  );
  const onOpenLink = useCallback<MarkdownDiagramProps['onOpenLink']>(
    (...args) => {
      record('onOpenLink', revisions.onOpenLink, args);
    },
    [record, revisions.onOpenLink],
  );
  const props = { kind, source, ...(omitWorkspace ? {} : { workspaceId }) };

  function loadSource(next: SourceName) {
    setSourceName(next);
    setKind(sources[next].kind);
    setSource(sources[next].source);
  }

  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      aria-label="Markdown diagram exercise"
      data-functional-example={id}
      data-testid={`${id}-section`}
    >
      <h2>Markdown diagram</h2>
      <ChoiceField
        id={`${id}-kind`}
        label="Diagram kind"
        value={kind}
        options={['diagram', 'mermaid']}
        onChange={setKind}
      />
      <ChoiceField
        id={`${id}-fixture`}
        label="Source input"
        value={sourceName}
        options={Object.keys(sources) as SourceName[]}
        onChange={loadSource}
      />
      <Button data-testid={`${id}-reload-source`} onClick={() => loadSource(sourceName)}>
        Reload selected source
      </Button>
      <FormField
        label="Diagram source"
        control={(field) => (
          <Textarea
            {...field}
            data-testid={`${id}-source`}
            value={source}
            rows={10}
            maxLength={16384}
            className="min-w-0 max-w-full"
            onChange={(event) => setSource(event.target.value)}
          />
        )}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <TextField
          id={`${id}-workspace`}
          label="Diagram workspace"
          value={workspaceId}
          onChange={setWorkspaceId}
        />
        <BooleanField
          id={`${id}-omit-workspace`}
          label="Omit diagram workspace"
          value={omitWorkspace}
          onChange={setOmitWorkspace}
        />
        <TextField
          id={`${id}-outer-panel`}
          label="Outer panel ID"
          value={outerPanel}
          onChange={setOuterPanel}
        />
        <BooleanField
          id={`${id}-omit-outer-panel`}
          label="Omit outer panel ID"
          value={omitOuterPanel}
          onChange={setOmitOuterPanel}
        />
        <TextField
          id={`${id}-inner-panel`}
          label="Inner panel ID"
          value={innerPanel}
          onChange={setInnerPanel}
        />
        <BooleanField
          id={`${id}-omit-inner-panel`}
          label="Omit inner panel ID"
          value={omitInnerPanel}
          onChange={setOmitInnerPanel}
        />
      </div>
      <ExerciseControls id={id} exercise={exercise} callbacks={['onOpenFile', 'onOpenLink']} />
      <Frame id={id} exercise={exercise}>
        <div
          data-testid={`${id}-outer`}
          data-panel-id={omitOuterPanel ? undefined : outerPanel}
          className="min-w-0 max-w-full"
        >
          <div
            data-testid={`${id}-inner`}
            data-panel-id={omitInnerPanel ? undefined : innerPanel}
            className="min-w-0 max-w-full"
          >
            {exercise.mounted && (
              <MarkdownDiagram
                key={exercise.mountRevision}
                {...props}
                onOpenFile={onOpenFile}
                onOpenLink={onOpenLink}
              />
            )}
          </div>
        </div>
      </Frame>
      <ExerciseOutputs
        id={id}
        exercise={exercise}
        inputs={{
          ...props,
          selectedSource: sourceName,
          outerPanel: omitOuterPanel ? undefined : outerPanel,
          innerPanel: omitInnerPanel ? undefined : innerPanel,
        }}
      />
    </section>
  );
}

export function MarkdownCompositionExamples() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-8">
      <p className="type-caption text-muted-foreground">
        Internal component exercises. Navigation requests are recorded at the host boundary.
        Clipboard copy and paste use the real browser. Native, motion and visual acceptance remain
        pending.
      </p>
      <MediaStatusExample />
      <MarkdownDiagramExample />
    </div>
  );
}
