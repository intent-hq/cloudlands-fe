// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useMemo, useRef, useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChiefStarterPrompts } from '@/features/chat/components/chief-starter-prompts';
import {
  SuggestedPrompts,
  type SuggestedPromptsProps,
} from '@/features/chat/components/suggested-prompts';
import { WorkspaceId } from '$shared/types/branded-ids';

type Composition = 'source' | 'chief';
type CallbackKind = 'select' | 'edit' | 'link';
type ElementObservation = {
  objectId: number;
  tagName: string;
  text: string | null;
  href: string | null;
  connected: boolean;
  inFrame: boolean;
  isAnchor: boolean;
};
type Observation = {
  kind: CallbackKind;
  callbackRevision: number;
  callbackObjectId: number;
  mountRevision: number;
  composition: Composition;
  inputRevision: number | null;
  inputArrayObjectId: number | null;
  rawPrompt?: string;
  matchingRawIndices?: number[] | null;
  url?: string;
  workspaceId?: string | null;
  event?: {
    objectId: number;
    type: string;
    constructorName: string;
    isMouseEvent: boolean;
    isKeyboardEvent: boolean;
    currentTarget: ElementObservation | null;
    target: ElementObservation | null;
    isTrusted: boolean;
    defaultPrevented: boolean;
    cancelBubble: boolean;
    bubbles: boolean;
    cancelable: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    key: string | null;
    code: string | null;
    repeat: boolean | null;
    button: number | null;
    detail: number;
  };
};

const initialPrompts = [
  'Review [the change](https://example.com/pull/17) and explain the risks.',
  'Open [the task](INTENT://local/task/example) before suggesting a next step.',
  'Compare [one](https://example.com/one) with [two](https://example.com/two).',
  'Summarize the remaining work.',
];

function BooleanField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <FormField
      label={label}
      disabled={disabled}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={value} onCheckedChange={onChange} />
      )}
    />
  );
}

export function SuggestedPromptExamples() {
  const [composition, setComposition] = useState<Composition>('source');
  const [draft, setDraft] = useState(() => JSON.stringify(initialPrompts, null, 2));
  const [applied, setApplied] = useState(() => ({ prompts: [...initialPrompts], revision: 0 }));
  const [inputError, setInputError] = useState('');
  const [compact, setCompact] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [includeWorkspace, setIncludeWorkspace] = useState(true);
  const [workspace, setWorkspace] = useState('prompt-workspace-a');
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [observations, setObservations] = useState<{
    total: number;
    counts: Record<CallbackKind, number>;
    history: Observation[];
  }>({ total: 0, counts: { select: 0, edit: 0, link: 0 }, history: [] });
  const frame = useRef<HTMLDivElement>(null);
  const identities = useRef({ objects: new WeakMap<object, number>(), next: 0 });

  // Identity labels are assigned to actual objects only when a callback runs.
  // Keeping this map across callback replacement lets the host observe anchor reuse.
  const callbacks = useMemo(() => {
    function identity(object: object) {
      const existing = identities.current.objects.get(object);
      if (existing !== undefined) return existing;
      const next = ++identities.current.next;
      identities.current.objects.set(object, next);
      return next;
    }
    function element(target: EventTarget | null): ElementObservation | null {
      if (!(target instanceof Element)) return null;
      return {
        objectId: identity(target),
        tagName: target.tagName,
        text: target.textContent,
        href: target.getAttribute('href'),
        connected: target.isConnected,
        inFrame: frame.current?.contains(target) ?? false,
        isAnchor: target instanceof HTMLAnchorElement,
      };
    }
    function context(callback: object) {
      return {
        callbackRevision,
        callbackObjectId: identity(callback),
        mountRevision,
        composition,
        inputRevision: composition === 'source' ? applied.revision : null,
        inputArrayObjectId: composition === 'source' ? identity(applied.prompts) : null,
      };
    }
    function record(observation: Observation) {
      setObservations((current) => ({
        total: current.total + 1,
        counts: {
          ...current.counts,
          [observation.kind]: current.counts[observation.kind] + 1,
        },
        history: [...current.history.slice(-11), observation],
      }));
    }
    function matchingRawIndices(prompt: string) {
      // Strings have value identity; report every exact caller match, including duplicates.
      return composition === 'source'
        ? applied.prompts.flatMap((raw, index) => (raw === prompt ? [index] : []))
        : null;
    }
    const onSelect: SuggestedPromptsProps['onSelect'] = (rawPrompt) => {
      record({
        kind: 'select',
        ...context(onSelect),
        rawPrompt,
        matchingRawIndices: matchingRawIndices(rawPrompt),
      });
    };
    const onEdit: NonNullable<SuggestedPromptsProps['onEdit']> = (rawPrompt) => {
      record({
        kind: 'edit',
        ...context(onEdit),
        rawPrompt,
        matchingRawIndices: matchingRawIndices(rawPrompt),
      });
    };
    const onOpenLink: SuggestedPromptsProps['onOpenLink'] = (url, { workspaceId, event }) => {
      // Snapshot synchronously while the source's native anchor listener is running.
      // The source owns cancellation; this host neither handles DOM events nor navigates.
      record({
        kind: 'link',
        ...context(onOpenLink),
        url,
        workspaceId: workspaceId ?? null,
        event: {
          objectId: identity(event),
          type: event.type,
          constructorName: event.constructor.name,
          isMouseEvent: event instanceof MouseEvent,
          isKeyboardEvent: event instanceof KeyboardEvent,
          currentTarget: element(event.currentTarget),
          target: element(event.target),
          isTrusted: event.isTrusted,
          defaultPrevented: event.defaultPrevented,
          cancelBubble: event.cancelBubble,
          bubbles: event.bubbles,
          cancelable: event.cancelable,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          key: event instanceof KeyboardEvent ? event.key : null,
          code: event instanceof KeyboardEvent ? event.code : null,
          repeat: event instanceof KeyboardEvent ? event.repeat : null,
          button: event instanceof MouseEvent ? event.button : null,
          detail: event.detail,
        },
      });
    };
    return { onSelect, onEdit, onOpenLink };
  }, [applied, callbackRevision, composition, mountRevision]);

  function applyPrompts() {
    let value: unknown;
    try {
      value = JSON.parse(draft);
    } catch {
      setInputError('Enter a JSON array of strings. The applied prompts have not changed.');
      return;
    }
    if (!Array.isArray(value) || !value.every((prompt) => typeof prompt === 'string')) {
      setInputError('Every prompt must be a string in a JSON array.');
      return;
    }
    const prompts: string[] = value;
    setApplied((current) => ({ prompts, revision: current.revision + 1 }));
    setInputError('');
  }

  const sourceMode = composition === 'source';
  const workspaceId = includeWorkspace ? WorkspaceId(workspace) : undefined;

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-functional-example="suggested-prompts"
      data-testid="suggested-prompts-exercise"
      aria-label="Suggested prompts exercise"
    >
      <h2>Suggested prompts and Chief starters</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased callback exercise. Links only record their arguments. Shortcut hints
        are presentation only; this caller installs no shortcuts. Chief owns its localized labels
        and selected prompt text.
      </p>
      <FormField
        label="Prompt composition"
        control={(field) => (
          <ToggleGroup
            {...field}
            aria-label="Prompt composition"
            type="single"
            value={composition}
            onValueChange={(next) => {
              if ((next === 'source' || next === 'chief') && next !== composition) {
                setComposition(next);
                setMountRevision((current) => current + 1);
              }
            }}
          >
            <ToggleGroupItem value="source">Suggested prompts</ToggleGroupItem>
            <ToggleGroupItem value="chief">Chief starters</ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="Raw prompts JSON"
        description="Apply an array of strings without trimming or rewriting. Use [] for no rows; change array order to reorder rows."
        error={inputError}
        disabled={!sourceMode}
        control={(field) => (
          <Textarea
            {...field}
            rows={6}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="suggested-prompts-json"
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button disabled={!sourceMode} onClick={applyPrompts}>
          Apply prompts
        </Button>
        <Button
          disabled={!sourceMode}
          onClick={() => {
            const prompts = [...applied.prompts].reverse();
            setApplied((current) => ({ prompts, revision: current.revision + 1 }));
            setDraft(JSON.stringify(prompts, null, 2));
            setInputError('');
          }}
        >
          Reverse prompts
        </Button>
      </div>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <BooleanField label="Compact prompts" value={compact} onChange={setCompact} />
        <BooleanField
          label="Show shortcut hints"
          value={showShortcutHints}
          onChange={setShowShortcutHints}
          disabled={!sourceMode}
        />
        <BooleanField
          label="Enable edit callback"
          value={editEnabled}
          onChange={setEditEnabled}
          disabled={!sourceMode}
        />
        <BooleanField
          label="Include workspace context"
          value={includeWorkspace}
          onChange={setIncludeWorkspace}
          disabled={!sourceMode}
        />
      </div>
      <FormField
        label="Prompt workspace ID"
        disabled={!sourceMode || !includeWorkspace}
        control={(field) => (
          <Input
            {...field}
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          />
        )}
      />
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <Button onClick={() => setCallbackRevision((current) => current + 1)}>
          Replace prompt callbacks
        </Button>
        <BooleanField
          label="Mount prompt component"
          value={mounted}
          onChange={(next) => {
            setMounted(next);
            if (next) setMountRevision((current) => current + 1);
          }}
        />
        <Button disabled={!mounted} onClick={() => setMountRevision((current) => current + 1)}>
          Remount prompt component
        </Button>
      </div>
      <div
        ref={frame}
        className="min-h-8 w-full min-w-0 max-w-[420px]"
        data-testid="suggested-prompts-frame"
      >
        {mounted && (
          <div
            key={mountRevision}
            className="min-w-0"
            data-testid="suggested-prompts-leaf"
            data-mount-revision={mountRevision}
          >
            {sourceMode ? (
              <SuggestedPrompts
                prompts={applied.prompts}
                onSelect={callbacks.onSelect}
                onEdit={editEnabled ? callbacks.onEdit : undefined}
                compact={compact}
                showShortcutHints={showShortcutHints}
                workspaceId={workspaceId}
                onOpenLink={callbacks.onOpenLink}
              />
            ) : (
              <ChiefStarterPrompts
                onSelect={callbacks.onSelect}
                compact={compact}
                onOpenLink={callbacks.onOpenLink}
              />
            )}
          </div>
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label="Prompt caller inputs"
        data-testid="suggested-prompts-inputs"
      >
        {JSON.stringify(
          {
            composition,
            mounted,
            mountRevision,
            callbackRevision,
            compact,
            sourceInputs: sourceMode
              ? {
                  inputRevision: applied.revision,
                  prompts: applied.prompts,
                  showShortcutHints,
                  editEnabled,
                  workspaceId: workspaceId ?? null,
                }
              : null,
          },
          null,
          2,
        )}
      </pre>
      <p className="type-caption text-muted-foreground">
        Counts include every callback since this exercise mounted; history keeps the latest 12.
        Object IDs identify actual observed arrays, callbacks, native events, and DOM nodes.
        Matching indices compare raw strings only. Source parsing and Chief label mapping remain
        inside the components. The frame is at most 420px wide; unbroken-word containment is
        unverified.
      </p>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        aria-label="Prompt callback observations"
        data-testid="suggested-prompts-observations"
      >
        {JSON.stringify(observations, null, 2)}
      </pre>
    </section>
  );
}
