// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PinnedUserPrompt } from '@/features/chat/components/pinned-user-prompt';
import { AgentPreviewToolLabel } from '@/features/chat/components/agent-preview-tool-label';
import type { IconDefinition } from '$lib/icons/icon-definition';
import type { ToolUseBlock } from '$shared/types';

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  numeric = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  error?: string;
}) {
  return (
    <FormField
      label={label}
      error={error}
      control={(field) =>
        multiline ? (
          <Textarea
            {...field}
            rows={5}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            {...field}
            type={numeric ? 'number' : 'text'}
            step={numeric ? 'any' : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
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

function ChoiceField({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly string[];
  onChange: (value: string) => void;
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
            if (choices.includes(next)) onChange(next);
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
  observations?: unknown;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(true);
  const [revision, setRevision] = useState(0);
  const [width, setWidth] = useState('320');
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-label={`${name} exercise`}
      data-testid={id}
    >
      <h3>{name}</h3>
      {controls}
      <ChoiceField
        label={`${name} frame width`}
        value={width}
        choices={['180', '320', '640']}
        onChange={setWidth}
      />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label={`Mount ${name}`} value={mounted} onChange={setMounted} />
        <Button disabled={!mounted} onClick={() => setRevision((current) => current + 1)}>
          Remount {name}
        </Button>
      </div>
      <div
        className="min-h-8 w-full min-w-0"
        style={{ maxWidth: Number(width) }}
        data-testid={`${id}-frame`}
      >
        {mounted && (
          <div key={revision} className="min-w-0" data-testid={`${id}-leaf`}>
            {children}
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label={`${name} caller state`}
        data-testid={`${id}-state`}
      >
        {JSON.stringify({ mounted, revision, width, inputs, observations }, null, 2)}
      </pre>
    </section>
  );
}

const promptPresets = {
  short: 'Review the changes.',
  long: 'Review the complete migration and explain which keyboard, pointer, overflow, and lifecycle behaviors still need independent verification. '.repeat(
    3,
  ),
  multiline: 'First line\nSecond line\nThird line',
  markdown: '**Literal prompt** with _emphasis_ and [a link](https://example.com)',
  empty: '',
};
const promptIcons: Record<string, IconDefinition | undefined> = {
  none: undefined,
  pin: { iconName: 'thumbtack' },
  file: { iconName: 'file-lines' },
};
type ActivationObservation = {
  callbackRevision: number;
  argumentCount: number;
  event: {
    objectId: number;
    nativeObjectId: number;
    sameAsCapturedNativeEvent: boolean;
    type: string;
    nativeType: string;
    detail: number;
    isTrusted: boolean;
    currentTargetLabel: string | null;
  } | null;
};

function PinnedPromptExercise() {
  const [text, setText] = useState(promptPresets.short);
  const [preset, setPreset] = useState('short');
  const [surface, setSurface] = useState<'user' | 'subscription'>('user');
  const [icon, setIcon] = useState('none');
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [calls, setCalls] = useState<ActivationObservation[]>([]);
  const capturedNativeEvent = useRef<Event | null>(null);
  const identities = useRef({ objects: new WeakMap<object, number>(), next: 0 });
  const onActivate = useMemo(() => {
    const identity = (object: object) => {
      const existing = identities.current.objects.get(object);
      if (existing !== undefined) return existing;
      const next = ++identities.current.next;
      identities.current.objects.set(object, next);
      return next;
    };
    return (...args: [event?: MouseEvent<HTMLButtonElement>]) => {
      const event = args[0];
      const observation: ActivationObservation = {
        callbackRevision,
        argumentCount: args.length,
        event: event
          ? {
              objectId: identity(event),
              nativeObjectId: identity(event.nativeEvent),
              sameAsCapturedNativeEvent: event.nativeEvent === capturedNativeEvent.current,
              type: event.type,
              nativeType: event.nativeEvent.type,
              detail: event.detail,
              isTrusted: event.isTrusted,
              currentTargetLabel: event.currentTarget.getAttribute('aria-label'),
            }
          : null,
      };
      setCalls((current) => [...current, observation]);
    };
  }, [callbackRevision]);

  return (
    <Exercise
      id="preview-pinned"
      name="Pinned prompt"
      inputs={{ text, surface, icon, callbackRevision }}
      observations={{ count: calls.length, calls }}
      controls={
        <>
          <ChoiceField
            label="Prompt preset"
            value={preset}
            choices={Object.keys(promptPresets)}
            onChange={(next) => {
              setPreset(next);
              setText(promptPresets[next as keyof typeof promptPresets]);
            }}
          />
          <TextField
            label="Prompt text"
            multiline
            value={text}
            onChange={(next) => {
              setPreset('');
              setText(next);
            }}
          />
          <ChoiceField
            label="Prompt surface"
            value={surface}
            choices={['user', 'subscription']}
            onChange={(next) => setSurface(next as 'user' | 'subscription')}
          />
          <ChoiceField
            label="Prompt icon"
            value={icon}
            choices={Object.keys(promptIcons)}
            onChange={setIcon}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button onClick={() => setCallbackRevision((current) => current + 1)}>
              Replace prompt callback
            </Button>
            <Button onClick={() => setCalls([])}>Clear prompt observations</Button>
          </div>
          <p className="type-caption text-muted-foreground">
            Enter and Space call the real callback with zero arguments. Pointer activation forwards
            a React synthetic event; the original Svelte caller receives a native event. Event
            identities and the captured native event comparison below are observed during
            activation.
          </p>
        </>
      }
    >
      <div
        className="min-w-0"
        onClickCapture={(event) => {
          capturedNativeEvent.current = event.nativeEvent;
        }}
      >
        <PinnedUserPrompt
          text={text}
          surface={surface}
          icon={promptIcons[icon]}
          onActivate={onActivate}
        />
      </div>
    </Exercise>
  );
}

const toolPresets = {
  read: {
    name: 'Read',
    input: { file_path: 'src/features/chat/components/pinned-user-prompt.tsx' },
  },
  command: { name: 'Bash', input: { command: 'git status --short' } },
  summary: {
    name: 'mcp__workspace-mcp__workspace_api',
    input: {
      code: 'return await ws.note.list()',
      summary:
        '**Review** _notes_ and `code` with [readable links](https://example.com) &amp; context',
    },
  },
  missing: {
    name: 'mcp__workspace-mcp__workspace_api',
    input: { code: 'return await ws.note.list()' },
  },
  deferred: { name: 'ToolSearch', input: { query: 'select:mcp__workspace-mcp__workspace_api' } },
  context7: {
    name: 'mcp__context7__query-docs',
    input: { libraryId: '/reactjs/react.dev', query: 'React effects' },
  },
  slack: { name: 'mcp__slack__search', input: { query: 'migration notes' } },
} satisfies Record<string, Pick<ToolUseBlock, 'name' | 'input'>>;

function ToolPreviewExercise() {
  const [toolUse, setToolUse] = useState<ToolUseBlock>({
    type: 'tool_use',
    id: 'catalog-tool:0',
    ...toolPresets.read,
  });
  const [preset, setPreset] = useState('read');
  const [draftName, setDraftName] = useState(toolUse.name);
  const [draftInput, setDraftInput] = useState(JSON.stringify(toolUse.input, null, 2));
  const [inputError, setInputError] = useState('');
  const [animate, setAnimate] = useState(false);
  const [showIcon, setShowIcon] = useState(true);
  const [size, setSize] = useState('');
  const [sourceClass, setSourceClass] = useState('');
  const [className, setClassName] = useState('');
  const [useClassName, setUseClassName] = useState(false);
  const iconSize = size.trim() !== '' && Number.isFinite(Number(size)) ? Number(size) : undefined;
  const props = {
    toolUse,
    animate,
    showIcon,
    iconSize,
    class: sourceClass,
    className: useClassName ? className : undefined,
  };

  return (
    <Exercise
      id="preview-tool"
      name="Tool preview"
      inputs={props}
      controls={
        <>
          <ChoiceField
            label="Tool preset"
            value={preset}
            choices={Object.keys(toolPresets)}
            onChange={(next) => {
              const value = toolPresets[next as keyof typeof toolPresets];
              setPreset(next);
              setDraftName(value.name);
              setDraftInput(JSON.stringify(value.input, null, 2));
              setInputError('');
              setToolUse((current) => ({ ...current, ...value }));
            }}
          />
          <TextField label="Tool name" value={draftName} onChange={setDraftName} />
          <TextField
            label="Tool input JSON"
            multiline
            value={draftInput}
            onChange={setDraftInput}
            error={inputError}
          />
          <div className="flex min-w-0 flex-wrap gap-3">
            <Button
              onClick={() => {
                try {
                  const input: unknown = JSON.parse(draftInput);
                  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
                    setInputError('Tool input must be a JSON object.');
                    return;
                  }
                  setToolUse((current) => ({
                    ...current,
                    name: draftName,
                    input: input as Record<string, unknown>,
                  }));
                  setPreset('');
                  setInputError('');
                } catch {
                  setInputError('Enter valid JSON before applying the tool input.');
                }
              }}
            >
              Apply tool input
            </Button>
          </div>
          <p className="type-caption text-muted-foreground">
            Presets and initial values use local icons only. Custom tool names can select remote
            brand images. Tool names, commands, and code are display inputs only and are never
            executed. The production component owns classification, hidden rows, and asynchronous
            plain-text Markdown conversion.
          </p>
          <div className="flex min-w-0 flex-wrap gap-3">
            <BooleanField label="Animate tool icon" value={animate} onChange={setAnimate} />
            <BooleanField label="Show tool icon" value={showIcon} onChange={setShowIcon} />
          </div>
          <TextField
            label="Tool icon size, blank for default"
            numeric
            value={size}
            onChange={setSize}
          />
          <TextField label="Tool source class" value={sourceClass} onChange={setSourceClass} />
          <BooleanField
            label="Use React className override"
            value={useClassName}
            onChange={setUseClassName}
          />
          <TextField label="Tool React className" value={className} onChange={setClassName} />
        </>
      }
    >
      <AgentPreviewToolLabel {...props} />
    </Exercise>
  );
}

export function ChatPreviewExamples() {
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8"
      aria-label="Chat preview examples"
      data-functional-example="chat-preview"
    >
      <p className="type-caption text-muted-foreground" data-internal-example>
        Internal migration exercise. Native behavior, source appearance parity, full motion, and
        product integration have separate acceptance checks.
      </p>
      <PinnedPromptExercise />
      <ToolPreviewExercise />
    </section>
  );
}
