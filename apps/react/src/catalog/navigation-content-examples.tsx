// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AugmentCodeSnippet,
  type AugmentCodeSnippetProps,
} from '@/components/editor/augment-code-snippet';
import { FormField } from '@/components/patterns/form';
import { useHighlightTarget } from '@/components/patterns/settings/highlight-target';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NavLink, type NavLinkProps } from '@/features/chat/components/nav-link';
import { selectUiHighlightToken } from '@/store/ui-highlight/ui-highlight-selectors';
import { isResolvableNavTarget } from '$shared/app-ui-targets';

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
            if (selected !== undefined) onChange(selected);
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
      className="block max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere"
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
    text: target.textContent,
    rawHref: target.closest('a')?.getAttribute('href') ?? null,
    closestPanel: target.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
  };
}

type Observation = Record<string, unknown>;
const callbackLimit = 20;
const nativeLimit = 40;

function useObservations() {
  const records = useRef({
    counts: {} as Record<string, number>,
    callbacks: [] as Observation[],
    native: [] as Observation[],
  });
  const captured = useRef<Event | null>(null);
  const identities = useRef({ next: 0, objects: new WeakMap<object, number>() });
  const [observations, setObservations] = useState({
    counts: {} as Record<string, number>,
    callbacks: [] as Observation[],
    native: [] as Observation[],
  });
  const objectId = useCallback((object: object) => {
    let id = identities.current.objects.get(object);
    if (id === undefined) {
      id = ++identities.current.next;
      identities.current.objects.set(object, id);
    }
    return id;
  }, []);
  const snapshotEvent = useCallback(
    (event: Event) => ({
      kind: 'native',
      objectId: objectId(event),
      type: event.type,
      isTrusted: event.isTrusted,
      eventPhase: event.eventPhase,
      currentTarget: describeElement(event.currentTarget),
      target: describeElement(event.target),
      defaultPrevented: event.defaultPrevented,
      cancelBubble: event.cancelBubble,
      sameAsCapturedEvent: event === captured.current,
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
    (
      name: string,
      callbackRevision: number,
      mountRevision: number,
      args: unknown[],
      extra?: Observation,
    ) => {
      function snapshotArgument(value: unknown): unknown {
        if (value instanceof Event) return snapshotEvent(value);
        if (typeof value === 'function') return { kind: 'function', objectId: objectId(value) };
        if (Array.isArray(value)) return value.map(snapshotArgument);
        if (value && typeof value === 'object') {
          // Keep a React wrapper distinct if a component ever supplies one.
          if ('nativeEvent' in value && value.nativeEvent instanceof Event) {
            const event = value as {
              nativeEvent: Event;
              currentTarget?: EventTarget;
              target?: EventTarget;
            };
            return {
              kind: 'react-synthetic',
              objectId: objectId(value),
              currentTarget: describeElement(event.currentTarget ?? null),
              target: describeElement(event.target ?? null),
              nativeEvent: snapshotEvent(event.nativeEvent),
            };
          }
          return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, snapshotArgument(entry)]),
          );
        }
        return value;
      }
      const current = records.current;
      current.counts[name] = (current.counts[name] ?? 0) + 1;
      current.callbacks = [
        ...current.callbacks.slice(-(callbackLimit - 1)),
        {
          name,
          sequence: current.counts[name],
          callbackRevision,
          mountRevision,
          argumentCount: args.length,
          arguments: args.map(snapshotArgument),
          lastCapturedEvent: captured.current ? snapshotEvent(captured.current) : null,
          ...extra,
        },
      ];
      // A file gate may be consulted during child rendering; publish only on explicit refresh.
    },
    [objectId, snapshotEvent],
  );
  const frameRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const cleanups = ['click', 'keydown', 'keyup', 'pointerdown', 'focusin', 'copy'].flatMap(
        (type) =>
          [true, false].map((capture) => {
            const listener = (event: Event) => {
              if (capture) captured.current = event;
              const name = `${type}-${capture ? 'capture' : 'bubble'}`;
              const current = records.current;
              current.counts[name] = (current.counts[name] ?? 0) + 1;
              current.native = [
                ...current.native.slice(-(nativeLimit - 1)),
                { name, sequence: current.counts[name], ...snapshotEvent(event) },
              ];
            };
            node.addEventListener(type, listener, { capture, passive: true });
            return () => node.removeEventListener(type, listener, capture);
          }),
      );
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        captured.current = null;
      };
    },
    [snapshotEvent],
  );
  const refresh = () =>
    setObservations({ ...records.current, counts: { ...records.current.counts } });
  const clear = () => {
    records.current = { counts: {}, callbacks: [], native: [] };
    captured.current = null;
    refresh();
  };
  return { record, frameRef, objectId, observations, refresh, clear };
}

function ObservationControls({
  name,
  recorder,
}: {
  name: string;
  recorder: ReturnType<typeof useObservations>;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={recorder.refresh}>Refresh {name} observations</Button>
        <Button onClick={recorder.clear}>Clear {name} observations</Button>
      </div>
      <Output
        label={`${name} observations`}
        value={{ callbackLimit, nativeLimit, ...recorder.observations }}
      />
    </>
  );
}

function HighlightObservation({ id }: { id: string }) {
  const highlight = useHighlightTarget(id);
  const token = selectUiHighlightToken(id);
  return (
    <div className="grid min-w-0 gap-2">
      <div ref={highlight} data-highlight-id={id} data-testid={`navigation-highlight-${id}`}>
        Highlight destination: {id}
      </div>
      <output aria-label={`${id} highlight token`}>{token.value}</output>
    </div>
  );
}

const navigationTargets = {
  'model alias': '/settings#default-model',
  'appearance alias': '/settings?tab=display#theme',
  'encoded alias': '/settings#%64efault-model',
  'settings without hash': '/settings',
  'workspace route': '/workspace/catalog-workspace',
  'agent route': '/agent/catalog-agent',
  'intent note': 'intent://local/note/spec',
  'intent file': 'intent://local/file/src/main.ts#L10-20',
  'padded intent': '  intent://local/note/spec  ',
  'long intent path': `intent://local/file/${'deep-directory/'.repeat(14)}navigation-example.ts`,
  'unknown route': '/specialists',
  'unknown settings hash': '/settings#not-a-real-setting',
  'malformed hash': '/settings#%E0%A4%A',
  'external URL': 'https://example.com/settings',
  empty: '',
};

function NavigationExercise() {
  const [target, setTarget] = useState(navigationTargets['model alias']);
  const [label, setLabel] = useState('Open local destination');
  const [includeLabel, setIncludeLabel] = useState(true);
  const [workspaceId, setWorkspaceId] = useState('catalog-workspace-a');
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [includeGate, setIncludeGate] = useState(true);
  const [gateResult, setGateResult] = useState(true);
  const [hostResult, setHostResult] = useState(true);
  const [holdNavigation, setHoldNavigation] = useState(false);
  const nextNavigation = useRef(0);
  const [pendingNavigations, setPendingNavigations] = useState<
    {
      id: number;
      target: string;
      callbackRevision: number;
      mountRevision: number;
      resolve: () => void;
    }[]
  >([]);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const recorder = useObservations();
  const { record, objectId, frameRef } = recorder;
  const canOpenFile = useMemo(
    () =>
      (...args: []) => {
        record('canOpenFile', callbackRevision, mountRevision, args, { result: gateResult });
        return gateResult;
      },
    [record, callbackRevision, mountRevision, gateResult],
  );
  const onNavigate: NavLinkProps['onNavigate'] = (...args) => {
    const id = ++nextNavigation.current;
    record('onNavigate', callbackRevision, mountRevision, args, { id, held: holdNavigation });
    if (holdNavigation)
      return new Promise<void>((resolve) => {
        setPendingNavigations((current) => [
          ...current,
          {
            id,
            target: args[0],
            callbackRevision,
            mountRevision,
            resolve,
          },
        ]);
      });
  };
  const onOpenLink: NavLinkProps['onOpenLink'] = async (...args) => {
    record('onOpenLink', callbackRevision, mountRevision, args, {
      sameAsCurrentFileGate: args[1].canOpenFile === (includeGate ? canOpenFile : undefined),
      currentFileGateId: includeGate ? objectId(canOpenFile) : null,
      result: hostResult,
    });
    return hostResult;
  };
  const optionalProps = {
    ...(includeLabel ? { label } : {}),
    ...(includeWorkspace ? { workspaceId } : {}),
    ...(includeGate ? { canOpenFile } : {}),
  };
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label="Navigation link exercise"
      data-testid="navigation-link"
    >
      <h3>Navigation link</h3>
      <p>
        The required host callbacks record the exact route and link arguments. They do not navigate
        or open files. The leaf owns canonical admission and highlight dispatch.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(navigationTargets).map(([name, value]) => (
          <Button key={name} onClick={() => setTarget(value)}>
            Target: {name}
          </Button>
        ))}
      </div>
      <TextField label="Navigation target" value={target} onChange={setTarget} />
      <TextField label="Navigation label" value={label} onChange={setLabel} />
      <Toggle label="Pass navigation label" value={includeLabel} onChange={setIncludeLabel} />
      <TextField label="Navigation workspace ID" value={workspaceId} onChange={setWorkspaceId} />
      <Toggle
        label="Pass navigation workspace"
        value={includeWorkspace}
        onChange={setIncludeWorkspace}
      />
      <Toggle label="Pass navigation file gate" value={includeGate} onChange={setIncludeGate} />
      <Toggle label="Navigation file gate result" value={gateResult} onChange={setGateResult} />
      <Toggle label="Navigation host link result" value={hostResult} onChange={setHostResult} />
      <Toggle
        label="Hold navigation completion"
        value={holdNavigation}
        onChange={setHoldNavigation}
      />
      <Toggle label="Mount navigation link" value={mounted} onChange={setMounted} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace navigation callbacks
        </Button>
        <Button disabled={!mounted} onClick={() => setMountRevision((value) => value + 1)}>
          Remount navigation link
        </Button>
        <Button
          disabled={pendingNavigations.length === 0}
          onClick={() => {
            const pending = pendingNavigations[0];
            if (!pending) return;
            record('resolveNavigation', pending.callbackRevision, pending.mountRevision, [], {
              id: pending.id,
              target: pending.target,
            });
            setPendingNavigations((current) => current.filter((entry) => entry.id !== pending.id));
            pending.resolve();
          }}
        >
          Complete oldest navigation
        </Button>
      </div>
      <div
        ref={frameRef}
        className="min-h-8 w-full min-w-0 max-w-[420px]"
        data-testid="navigation-link-frame"
      >
        {mounted && (
          <NavLink
            key={mountRevision}
            target={target}
            {...optionalProps}
            onNavigate={onNavigate}
            onOpenLink={onOpenLink}
          />
        )}
      </div>
      <HighlightObservation id="utility-default-model" />
      <HighlightObservation id="appearance" />
      <Output
        label="Navigation link inputs"
        value={{
          target,
          ...optionalProps,
          canOpenFile: includeGate ? { present: true, result: gateResult } : '[omitted]',
          passedOptionalProps: Object.keys(optionalProps),
          canonicalResolvable: isResolvableNavTarget(target),
          mounted,
          mountRevision,
          callbackRevision,
          hostResult,
          holdNavigation,
          pendingNavigations: pendingNavigations.map(
            ({ id, target, callbackRevision, mountRevision }) => ({
              id,
              target,
              callbackRevision,
              mountRevision,
            }),
          ),
        }}
      />
      <ObservationControls name="navigation" recorder={recorder} />
    </section>
  );
}

const codeSamples = {
  initial: 'const greeting = "Hello, excerpt";\nconsole.log(greeting);',
  replacement: 'const updated = "Current excerpt — 日本語";\nconsole.log(updated);\n',
  markup: '<section title="quoted & safe">\n  <script>alert("inert code")</script>\n</section>',
  long: `const path = "${'long-code-directory/'.repeat(18)}file.ts";`,
  multiline: Array.from({ length: 30 }, (_, index) => `console.log("Line ${index + 1}");`).join(
    '\n',
  ),
  empty: '',
};
const pathSamples = {
  range: 'src/example.ts:10-20',
  replacement: 'src/replacement.ts:42',
  'extra colon': 'src/example.ts:10-20:ignored',
  'empty range': 'src/example.ts::trailing',
  windows: 'C:\\work\\example.ts:15',
  long: `${'deep-directory/'.repeat(12)}long-excerpt-file.ts:100-120`,
  empty: '',
};
const snippetFields = ['code', 'language', 'path', 'mode'] as const;
type SnippetField = (typeof snippetFields)[number];

function ClipboardPasteTarget() {
  const [text, setText] = useState('');
  const [receipts, setReceipts] = useState<Observation[]>([]);
  const sequence = useRef(0);
  const pasteRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return;
    const listener = (event: ClipboardEvent) => {
      const receipt = {
        sequence: ++sequence.current,
        kind: 'native',
        type: event.type,
        isTrusted: event.isTrusted,
        currentTarget: describeElement(event.currentTarget),
        target: describeElement(event.target),
        text: event.clipboardData?.getData('text/plain'),
        types: Array.from(event.clipboardData?.types ?? []),
      };
      setReceipts((current) => [...current.slice(-5), receipt]);
    };
    node.addEventListener('paste', listener);
    return () => node.removeEventListener('paste', listener);
  }, []);
  return (
    <>
      <FormField
        label="Paste copied excerpt"
        description="Use the native clipboard to paste the real CodeBlock copy result. Typing here does not create a paste receipt."
        control={(field) => (
          <Textarea
            {...field}
            ref={pasteRef}
            data-testid="code-excerpt-paste-target"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
          />
        )}
      />
      <Output label="Code excerpt clipboard receipts" value={{ limit: 6, text, receipts }} />
    </>
  );
}

function Panels({
  mode,
  outer,
  inner,
  children,
}: {
  mode: 'none' | 'outer' | 'nested';
  outer: string;
  inner: string;
  children: ReactNode;
}) {
  return (
    <div data-panel-id={mode === 'none' ? undefined : outer} data-testid="code-excerpt-outer-panel">
      <div
        data-panel-id={mode === 'nested' ? inner : undefined}
        data-testid="code-excerpt-inner-panel"
      >
        {children}
      </div>
    </div>
  );
}

function CodeExcerptExercise() {
  const [values, setValues] = useState<Record<SnippetField, string>>({
    code: codeSamples.initial,
    language: 'typescript',
    path: pathSamples.range,
    mode: 'EXCERPT',
  });
  const [included, setIncluded] = useState<Record<SnippetField, boolean>>({
    code: true,
    language: true,
    path: true,
    mode: true,
  });
  const [lineNumbers, setLineNumbers] = useState<'omit' | 'true' | 'false'>('omit');
  const [includeCallback, setIncludeCallback] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [panelMode, setPanelMode] = useState<'none' | 'outer' | 'nested'>('nested');
  const [outerPanel, setOuterPanel] = useState('catalog-outer-panel');
  const [innerPanel, setInnerPanel] = useState('catalog-inner-panel');
  const recorder = useObservations();
  const { record, frameRef } = recorder;
  const props: AugmentCodeSnippetProps = {};
  for (const field of snippetFields) if (included[field]) props[field] = values[field];
  if (lineNumbers !== 'omit') props.showLineNumbers = lineNumbers === 'true';
  if (includeCallback)
    props.onOpenFile = (...args) => record('onOpenFile', callbackRevision, mountRevision, args);
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label="Code excerpt exercise"
      data-testid="code-excerpt"
    >
      <h3>Code excerpt</h3>
      <p>
        The production excerpt renders the real CodeBlock. The optional file callback records its
        detail without opening a file; the nested panel attributes are actual ancestor nodes.
      </p>
      <div className="flex flex-wrap gap-2">
        {Object.entries(codeSamples).map(([name, code]) => (
          <Button key={name} onClick={() => setValues((current) => ({ ...current, code }))}>
            Code: {name}
          </Button>
        ))}
        {Object.entries(pathSamples).map(([name, path]) => (
          <Button key={name} onClick={() => setValues((current) => ({ ...current, path }))}>
            Path: {name}
          </Button>
        ))}
        <Button
          onClick={() => {
            setIncluded({ code: false, language: false, path: false, mode: false });
            setLineNumbers('omit');
            setIncludeCallback(false);
          }}
        >
          Omit all excerpt props
        </Button>
      </div>
      {snippetFields.map((field) => (
        <div key={field} className="grid min-w-0 gap-2">
          <TextField
            label={`Excerpt ${field}`}
            value={values[field]}
            multiline={field === 'code'}
            onChange={(value) => setValues((current) => ({ ...current, [field]: value }))}
          />
          <Toggle
            label={`Pass excerpt ${field}`}
            value={included[field]}
            onChange={(value) => setIncluded((current) => ({ ...current, [field]: value }))}
          />
        </div>
      ))}
      <Choice
        label="Excerpt line numbers"
        value={lineNumbers}
        options={['omit', 'true', 'false']}
        onChange={setLineNumbers}
      />
      <Toggle
        label="Pass excerpt file callback"
        value={includeCallback}
        onChange={setIncludeCallback}
      />
      <Choice
        label="Excerpt panel ancestry"
        value={panelMode}
        options={['none', 'outer', 'nested']}
        onChange={setPanelMode}
      />
      <TextField label="Excerpt outer panel ID" value={outerPanel} onChange={setOuterPanel} />
      <TextField label="Excerpt inner panel ID" value={innerPanel} onChange={setInnerPanel} />
      <Toggle label="Mount code excerpt" value={mounted} onChange={setMounted} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace excerpt callback
        </Button>
        <Button disabled={!mounted} onClick={() => setMountRevision((value) => value + 1)}>
          Remount code excerpt
        </Button>
      </div>
      <div
        ref={frameRef}
        className="min-h-8 w-full min-w-0 max-w-[420px]"
        data-testid="code-excerpt-frame"
      >
        <Panels mode={panelMode} outer={outerPanel} inner={innerPanel}>
          {mounted && <AugmentCodeSnippet key={mountRevision} {...props} />}
        </Panels>
      </div>
      <ClipboardPasteTarget />
      <Output
        label="Code excerpt inputs"
        value={{
          ...props,
          onOpenFile: includeCallback ? 'present' : '[omitted]',
          passedProps: Object.keys(props),
          mounted,
          mountRevision,
          callbackRevision,
          panelMode,
          outerPanel,
          innerPanel,
        }}
      />
      <ObservationControls name="excerpt" recorder={recorder} />
    </section>
  );
}

export function NavigationContentExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Navigation and code content examples"
      data-functional-example="navigation-content"
    >
      <h2>Navigation and code content</h2>
      <p>
        Internal migration exercises. Refresh observations after an interaction to publish the
        bounded synchronous records. Navigation and file callbacks are observation hosts, not
        product navigation.
      </p>
      <NavigationExercise />
      <CodeExcerptExercise />
    </section>
  );
}
