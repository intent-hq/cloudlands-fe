// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { CodeBlock } from '@/components/editor/code-block';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChatReferenceBlock,
  type ChatReferenceBlockProps,
  type ReferenceData,
} from '@/features/chat/components/chat-reference-block';
import { ContextChip, type ContextChipProps } from '@/features/chat/components/context-chip';
import type { IconDefinition } from '$lib/icons/icon-definition';
import { faNote } from '$lib/icons/faNote';

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

function ChoiceField<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: readonly T[];
  onChange: (value: T) => void;
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
            const choice = choices.find((candidate) => candidate === next);
            if (choice !== undefined) onChange(choice);
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
  observations: unknown;
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
      <div className="min-h-8 w-full min-w-0 max-w-[420px]" data-testid={`${id}-frame`}>
        {mounted && (
          <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
            {children}
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label={`${name} state`}
        data-testid={`${id}-state`}
      >
        {JSON.stringify({ mounted, revision, inputs, observations }, null, 2)}
      </pre>
    </section>
  );
}

const codePresets = {
  current: 'const message = "Hello, reference";\nconsole.log(message);',
  replacement: 'const updated = "Current content — 日本語";\nconsole.log(updated);\n',
  markup:
    '<section data-example="quoted & safe">\n  <script>alert("text only")</script>\n</section>',
  long: `const path = "${'very-long-reference-path/'.repeat(18)}file.ts";`,
  multiline: Array.from({ length: 30 }, (_, index) => `console.log("Line ${index + 1}");`).join(
    '\n',
  ),
  empty: '',
};

function CodeExercise() {
  const [preset, setPreset] = useState<keyof typeof codePresets>('current');
  const [code, setCode] = useState(codePresets.current);
  const [language, setLanguage] = useState('typescript');
  const [start, setStart] = useState('1');
  const [highlights, setHighlights] = useState('');
  const [height, setHeight] = useState('');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [noBorder, setNoBorder] = useState(false);
  const [noMargin, setNoMargin] = useState(false);
  const [doScroll, setDoScroll] = useState(true);
  const [pastedText, setPastedText] = useState('');
  const startLineNumber = Number.isInteger(Number(start)) ? Number(start) : 1;
  const highlightLines = highlights
    .split(',')
    .filter((value) => value.trim() !== '')
    .map(Number)
    .filter(Number.isInteger);
  const maxHeight = Number(height) > 0 ? Number(height) : undefined;
  const inputs = {
    code,
    language,
    startLineNumber,
    highlightLines,
    maxHeight,
    showLineNumbers,
    noBorder,
    noMargin,
    doScroll,
  };
  return (
    <Exercise
      id="reference-code"
      name="Code block"
      inputs={inputs}
      observations={{ pastedText }}
      controls={
        <>
          <ChoiceField
            label="Code preset"
            value={preset}
            choices={Object.keys(codePresets) as (keyof typeof codePresets)[]}
            onChange={(choice) => {
              setPreset(choice);
              setCode(codePresets[choice]);
            }}
          />
          <TextField label="Code" multiline value={code} onChange={setCode} />
          <TextField label="Code language" value={language} onChange={setLanguage} />
          <TextField label="Start line number" value={start} onChange={setStart} />
          <TextField
            label="Highlight lines, comma separated"
            value={highlights}
            onChange={setHighlights}
          />
          <TextField
            label="Maximum code height, blank for none"
            value={height}
            onChange={setHeight}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <BooleanField
              label="Show line numbers"
              value={showLineNumbers}
              onChange={setShowLineNumbers}
            />
            <BooleanField label="No border" value={noBorder} onChange={setNoBorder} />
            <BooleanField label="No margin" value={noMargin} onChange={setNoMargin} />
            <BooleanField
              label="Scroll code horizontally"
              value={doScroll}
              onChange={setDoScroll}
            />
          </div>
          <TextField
            label="Paste copied code"
            multiline
            value={pastedText}
            onChange={setPastedText}
          />
        </>
      }
    >
      <CodeBlock {...inputs} />
    </Exercise>
  );
}

type NativeObservation = {
  type: string;
  isTrusted: boolean;
  detail: number;
  ctrlKey: boolean;
  metaKey: boolean;
  buttonLabel: string | null;
  panelId: string | null;
};

function observeEvent(event: MouseEvent<HTMLDivElement>): NativeObservation {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button');
  return {
    type: event.type,
    isTrusted: event.isTrusted,
    detail: event.detail,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    buttonLabel: button?.getAttribute('aria-label') ?? button?.textContent ?? null,
    panelId: target?.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null,
  };
}

const referencePresets = {
  path: { filePath: 'src/example.ts', semanticId: '' },
  zero: { filePath: 'src/example.ts#L0', semanticId: '' },
  range: { filePath: 'src/example.ts#L7-9', semanticId: '' },
  hash: { filePath: 'src/literal#name.ts', semanticId: '' },
  symbolPath: { filePath: 'src/example.ts#symbol:Example', semanticId: '' },
  semantic: { filePath: '', semanticId: 'src/semantic.ts#L23-25' },
  symbol: { filePath: '', semanticId: 'src/semantic.ts#symbol:Example' },
  precedence: { filePath: 'src/explicit.ts#L7-9', semanticId: 'src/semantic.ts#L23-25' },
  empty: { filePath: '', semanticId: '' },
};
type OpenArgs = Parameters<NonNullable<ChatReferenceBlockProps['onOpenFile']>>;

function ReferenceExercise() {
  const [preset, setPreset] = useState<keyof typeof referencePresets>('range');
  const [filePath, setFilePath] = useState(referencePresets.range.filePath);
  const [semanticId, setSemanticId] = useState('');
  const [includeCallback, setIncludeCallback] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [panelId, setPanelId] = useState('reference-outer-panel');
  const [nestedPanelId, setNestedPanelId] = useState('');
  const [includeSnapshot, setIncludeSnapshot] = useState(false);
  const [snapshotCode, setSnapshotCode] = useState(codePresets.current);
  const [snapshotLanguage, setSnapshotLanguage] = useState('typescript');
  const [pastedText, setPastedText] = useState('');
  const [callbacks, setCallbacks] = useState<{ revision: number; args: OpenArgs }[]>([]);
  const [captureEvents, setCaptureEvents] = useState<NativeObservation[]>([]);
  const onOpenFile = useMemo(
    () =>
      (...args: OpenArgs) =>
        setCallbacks((current) => [...current, { revision: callbackRevision, args }]),
    [callbackRevision],
  );
  const reference: ReferenceData = {
    filePath: filePath || undefined,
    semanticId: semanticId || undefined,
    snapshot: includeSnapshot
      ? { code: snapshotCode, filePath: 'src/snapshot.ts', languageId: snapshotLanguage }
      : undefined,
  };
  return (
    <Exercise
      id="reference-block"
      name="File reference"
      inputs={{ reference, includeCallback, callbackRevision, panelId, nestedPanelId }}
      observations={{ callbacks, captureEvents, pastedText }}
      controls={
        <>
          <ChoiceField
            label="Reference preset"
            value={preset}
            choices={Object.keys(referencePresets) as (keyof typeof referencePresets)[]}
            onChange={(choice) => {
              setPreset(choice);
              setFilePath(referencePresets[choice].filePath);
              setSemanticId(referencePresets[choice].semanticId);
            }}
          />
          <TextField label="Reference file path" value={filePath} onChange={setFilePath} />
          <TextField label="Reference semantic ID" value={semanticId} onChange={setSemanticId} />
          <TextField
            label="Enclosing panel ID, blank for none"
            value={panelId}
            onChange={setPanelId}
          />
          <TextField
            label="Nested panel ID, blank for none"
            value={nestedPanelId}
            onChange={setNestedPanelId}
          />
          <BooleanField
            label="Include open callback"
            value={includeCallback}
            onChange={setIncludeCallback}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button onClick={() => setCallbackRevision((current) => current + 1)}>
              Replace reference callback
            </Button>
            <Button
              onClick={() => {
                setCallbacks([]);
                setCaptureEvents([]);
              }}
            >
              Clear reference observations
            </Button>
          </div>
          <BooleanField
            label="Include snapshot"
            value={includeSnapshot}
            onChange={setIncludeSnapshot}
          />
          <TextField
            label="Snapshot code"
            multiline
            value={snapshotCode}
            onChange={setSnapshotCode}
          />
          <TextField
            label="Snapshot language"
            value={snapshotLanguage}
            onChange={setSnapshotLanguage}
          />
          <TextField
            label="Paste copied snapshot"
            multiline
            value={pastedText}
            onChange={setPastedText}
          />
        </>
      }
    >
      <div
        role="presentation"
        data-testid="reference-panel"
        data-panel-id={panelId || undefined}
        onClickCapture={(event) => {
          const observation = observeEvent(event);
          setCaptureEvents((current) => [...current, observation]);
        }}
      >
        <div data-panel-id={nestedPanelId || undefined}>
          <ChatReferenceBlock
            reference={reference}
            onOpenFile={includeCallback ? onOpenFile : undefined}
          />
        </div>
      </div>
    </Exercise>
  );
}

const chipTypes = [
  'file',
  'diff',
  'note',
  'spec',
  'selection',
  'folder',
  'workspace',
  'memory',
  'personality',
  'linear',
  'github',
  'sentry',
  'external',
] as const satisfies readonly ContextChipProps['type'][];
const customIcons = {
  default: undefined,
  note: faNote,
  github: { iconName: 'github' },
  folder: { iconName: 'folder' },
  unknown: { iconName: 'catalog-unknown-icon' },
} satisfies Record<string, IconDefinition | undefined>;
type ChipCallbackObservation = {
  action: 'click' | 'sourceClick' | 'remove';
  revision: number;
  label: string;
  argumentCount: number;
};

function ChipExercise() {
  const [type, setType] = useState<ContextChipProps['type']>('file');
  const [label, setLabel] = useState('example.ts');
  const [maxLabelWidth, setMaxLabelWidth] = useState('200px');
  const [icon, setIcon] = useState<keyof typeof customIcons>('default');
  const [tooltipMode, setTooltipMode] = useState<'omitted' | 'equal' | 'empty' | 'custom'>(
    'omitted',
  );
  const [customTooltip, setCustomTooltip] = useState('Open current context');
  const [clickable, setClickable] = useState(true);
  const [removable, setRemovable] = useState(true);
  const [includeClick, setIncludeClick] = useState(true);
  const [includeSourceClick, setIncludeSourceClick] = useState(false);
  const [includeRemove, setIncludeRemove] = useState(true);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [callbacks, setCallbacks] = useState<ChipCallbackObservation[]>([]);
  const [parentClicks, setParentClicks] = useState<NativeObservation[]>([]);
  const [parentPointerDowns, setParentPointerDowns] = useState<NativeObservation[]>([]);
  const tooltip =
    tooltipMode === 'omitted'
      ? undefined
      : tooltipMode === 'equal'
        ? label
        : tooltipMode === 'empty'
          ? ''
          : customTooltip;
  const handlers = useMemo(() => {
    const record = (action: ChipCallbackObservation['action'], args: unknown[]) => {
      setCallbacks((current) => [
        ...current,
        { action, revision: callbackRevision, label, argumentCount: args.length },
      ]);
    };
    return {
      onClick: (...args: unknown[]) => record('click', args),
      onclick: (...args: unknown[]) => record('sourceClick', args),
      onRemove: (...args: unknown[]) => record('remove', args),
    };
  }, [callbackRevision, label]);
  return (
    <Exercise
      id="reference-chip"
      name="Context chip"
      inputs={{
        type,
        label,
        maxLabelWidth,
        icon,
        tooltipMode,
        tooltip,
        clickable,
        removable,
        includeClick,
        includeSourceClick,
        includeRemove,
        callbackRevision,
      }}
      observations={{ callbacks, parentClicks, parentPointerDowns }}
      controls={
        <>
          <ChoiceField label="Context type" value={type} choices={chipTypes} onChange={setType} />
          <TextField label="Context label" value={label} onChange={setLabel} />
          <Button
            onClick={() =>
              setLabel('Very long context label with current file name — 日本語 — '.repeat(4))
            }
          >
            Use long context label
          </Button>
          <TextField
            label="Maximum label width"
            value={maxLabelWidth}
            onChange={setMaxLabelWidth}
          />
          <ChoiceField
            label="Custom context icon"
            value={icon}
            choices={Object.keys(customIcons) as (keyof typeof customIcons)[]}
            onChange={setIcon}
          />
          <ChoiceField
            label="Context tooltip"
            value={tooltipMode}
            choices={['omitted', 'equal', 'empty', 'custom']}
            onChange={setTooltipMode}
          />
          <TextField
            label="Custom tooltip text"
            value={customTooltip}
            onChange={setCustomTooltip}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <BooleanField label="Clickable chip" value={clickable} onChange={setClickable} />
            <BooleanField label="Removable chip" value={removable} onChange={setRemovable} />
            <BooleanField
              label="Include click callback"
              value={includeClick}
              onChange={setIncludeClick}
            />
            <BooleanField
              label="Include source click callback"
              value={includeSourceClick}
              onChange={setIncludeSourceClick}
            />
            <BooleanField
              label="Include remove callback"
              value={includeRemove}
              onChange={setIncludeRemove}
            />
          </div>
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button onClick={() => setCallbackRevision((current) => current + 1)}>
              Replace chip callbacks
            </Button>
            <Button
              onClick={() => {
                setCallbacks([]);
                setParentClicks([]);
                setParentPointerDowns([]);
              }}
            >
              Clear chip observations
            </Button>
          </div>
        </>
      }
    >
      <div
        role="presentation"
        className="grid min-w-0 justify-items-start gap-3 py-2"
        data-testid="reference-chip-parent"
        onClick={(event) => {
          const observation = observeEvent(event);
          setParentClicks((current) => [...current, observation]);
        }}
        onPointerDown={(event) => {
          const observation = observeEvent(event);
          setParentPointerDowns((current) => [...current, observation]);
        }}
      >
        <p className="type-caption text-muted-foreground">Parent observation area</p>
        <ContextChip
          type={type}
          label={label}
          maxLabelWidth={maxLabelWidth}
          icon={customIcons[icon]}
          tooltip={tooltip}
          clickable={clickable}
          removable={removable}
          onClick={includeClick ? handlers.onClick : undefined}
          onclick={includeSourceClick ? handlers.onclick : undefined}
          onRemove={includeRemove ? handlers.onRemove : undefined}
        />
      </div>
    </Exercise>
  );
}

export function ChatReferenceExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Chat reference examples"
      data-functional-example="chat-reference"
    >
      <p className="type-caption text-muted-foreground" data-internal-example>
        Internal migration exercise. Use the catalog theme controls or theme URL parameter. Native
        behavior, source appearance parity, and product integration remain unverified.
      </p>
      <CodeExercise />
      <ReferenceExercise />
      <ChipExercise />
    </section>
  );
}
