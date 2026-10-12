// i18n-ignore (internal catalog caller inputs and observations, not released product copy)
import { useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlinePermissionRequest } from '@/features/chat/components/inline-permission-request';
import type { PermissionRequest } from '../../../../src/store/renderer/slices/permission/permission-types';

const initialRequest: PermissionRequest = {
  requestId: 'catalog-permission-a',
  workspaceId: 'catalog-permission-workspace',
  sessionId: 'catalog-permission-session',
  title: 'mcp__read_file',
  description: '{"path":"src/example.ts"}',
  agentName: 'Catalog agent',
  options: [
    { id: 'allow_once', label: 'Allow once', description: 'This request only' },
    { id: 'reject_once', label: 'Deny', destructive: true },
    { id: 'allow_ALWAYS', label: 'Always allow' },
  ],
  timestamp: 1791763200000,
};
const initialDraft = {
  requestId: initialRequest.requestId,
  workspaceId: initialRequest.workspaceId ?? '',
  title: initialRequest.title,
  description: initialRequest.description ?? '',
  descriptionMode: 'text' as 'text' | 'null' | 'undefined',
  agentName: initialRequest.agentName ?? '',
  options: JSON.stringify(initialRequest.options, null, 2),
  pendingCount: '1',
};

// Validate only the caller's JSON input shape. The real component owns filtering,
// parsing, shortcuts, admission and dispatch; no permission behavior is simulated here.
function isOptions(value: unknown): value is PermissionRequest['options'] {
  return (
    Array.isArray(value) &&
    value.every(
      (option: unknown) =>
        typeof option === 'object' &&
        option !== null &&
        'id' in option &&
        typeof option.id === 'string' &&
        'label' in option &&
        typeof option.label === 'string' &&
        (!('description' in option) || typeof option.description === 'string') &&
        (!('destructive' in option) || typeof option.destructive === 'boolean'),
    )
  );
}

function ChoiceField<T extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
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
          data-testid={`permission-${name}`}
          className="min-w-0 flex-wrap justify-start"
          value={value}
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              data-testid={`permission-${name}-${option}`}
            >
              {option}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  );
}

export function InlinePermissionExamples() {
  const [draft, setDraft] = useState(initialDraft);
  const [request, setRequest] = useState(initialRequest);
  const [pendingCount, setPendingCount] = useState(1);
  const [inputError, setInputError] = useState('');
  const [inputRevision, setInputRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] = useState(false);
  const [width, setWidth] = useState('420');
  const [anchorCount, setAnchorCount] = useState(0);
  const [anchorValue, setAnchorValue] = useState('');

  function change<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function apply() {
    let options: unknown;
    try {
      options = JSON.parse(draft.options);
    } catch {
      setInputError('Enter a valid JSON array of permission options.');
      return;
    }
    if (!isOptions(options)) {
      setInputError(
        'Each option needs string id and label fields; description is an optional string and destructive is an optional boolean.',
      );
      return;
    }
    const count = Number(draft.pendingCount);
    if (draft.pendingCount.trim() === '' || !Number.isSafeInteger(count) || count < 0) {
      setInputError('Enter a nonnegative whole pending count.');
      return;
    }
    setRequest({
      requestId: draft.requestId,
      workspaceId: draft.workspaceId || undefined,
      sessionId: initialRequest.sessionId,
      title: draft.title,
      description:
        draft.descriptionMode === 'text'
          ? draft.description
          : draft.descriptionMode === 'null'
            ? null
            : undefined,
      agentName: draft.agentName,
      options,
      timestamp: initialRequest.timestamp,
    });
    setPendingCount(count);
    setInputRevision((value) => value + 1);
    setInputError('');
  }

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
      data-functional-example="inline-permission"
      data-testid="inline-permission-exercise"
      aria-label="Inline permission request exercise"
    >
      <h2>Inline permission request</h2>
      <p className="type-caption text-muted-foreground">
        Internal, unreleased component fixture for a bridge-free runtime without an admitted
        workspace. These local props do not insert permission or workspace records into the Store.
        You cannot approve or deny real permissions here. Successful permission dispatch, responses
        and hydrated state remain unverified.
      </p>
      <p className="type-caption text-muted-foreground">
        Apply replaces the request on the current instance, preserving its raw-details disclosure.
        Remount resets the component; the mounted switch removes it. Parsing, option filtering and
        shortcuts belong to the actual component. Option IDs, labels and descriptions pass through
        unchanged. The focus anchors below stay mounted independently of the permission component.
      </p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(
          [
            ['title', 'Request title'],
            ['agentName', 'Agent name'],
            ['workspaceId', 'Workspace ID (empty omits)'],
            ['requestId', 'Request ID'],
          ] as const
        ).map(([key, label]) => (
          <FormField
            key={key}
            label={label}
            control={(field) => (
              <Input
                {...field}
                data-testid={`permission-${key}`}
                value={draft[key]}
                onChange={(event) => change(key, event.target.value)}
              />
            )}
          />
        ))}
      </div>
      <FormField
        label="Raw description"
        control={(field) => (
          <Textarea
            {...field}
            data-testid="permission-description"
            value={draft.description}
            onChange={(event) => change('description', event.target.value)}
          />
        )}
      />
      <ChoiceField
        name="description-mode"
        label="Description prop"
        value={draft.descriptionMode}
        options={['text', 'null', 'undefined']}
        onChange={(value) => change('descriptionMode', value)}
      />
      <FormField
        label="Options JSON"
        control={(field) => (
          <Textarea
            {...field}
            data-testid="permission-options"
            value={draft.options}
            rows={8}
            onChange={(event) => change('options', event.target.value)}
          />
        )}
      />
      <FormField
        label="Pending count"
        control={(field) => (
          <Input
            {...field}
            type="number"
            min={0}
            step={1}
            data-testid="permission-pendingCount"
            value={draft.pendingCount}
            onChange={(event) => change('pendingCount', event.target.value)}
          />
        )}
      />
      <div>
        <Button data-testid="permission-apply" onClick={apply}>
          Apply permission inputs
        </Button>
      </div>
      {inputError && (
        <p role="alert" className="min-w-0 wrap-anywhere" data-testid="permission-input-error">
          {inputError}
        </p>
      )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <FormField
          label="Permission component mounted"
          control={(field) => (
            <Switch
              {...field}
              ariaLabel="Permission component mounted"
              data-testid="permission-mounted"
              checked={mounted}
              onCheckedChange={setMounted}
            />
          )}
        />
        <FormField
          label="Keyboard shortcuts enabled"
          control={(field) => (
            <Switch
              {...field}
              ariaLabel="Keyboard shortcuts enabled"
              data-testid="permission-shortcuts"
              checked={keyboardShortcutsEnabled}
              onCheckedChange={setKeyboardShortcutsEnabled}
            />
          )}
        />
      </div>
      <ChoiceField
        name="width"
        label="Permission frame width"
        value={width}
        options={['320', '420', '640']}
        onChange={setWidth}
      />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button
          data-testid="permission-remount"
          disabled={!mounted}
          onClick={() => setMountRevision((value) => value + 1)}
        >
          Remount permission component
        </Button>
        <Button
          data-testid="permission-focus-anchor"
          onClick={() => setAnchorCount((value) => value + 1)}
        >
          Focus anchor
        </Button>
      </div>
      <FormField
        label="Editable focus anchor"
        control={(field) => (
          <Input
            {...field}
            data-testid="permission-editable-anchor"
            value={anchorValue}
            onChange={(event) => setAnchorValue(event.target.value)}
          />
        )}
      />
      <output data-testid="permission-anchor-count" aria-label="Focus anchor activations">
        {anchorCount}
      </output>
      <div
        className="min-w-0 max-w-full"
        style={{ width: Number(width) }}
        data-testid="inline-permission-frame"
      >
        {mounted && (
          <InlinePermissionRequest
            key={mountRevision}
            request={request}
            pendingCount={pendingCount}
            keyboardShortcutsEnabled={keyboardShortcutsEnabled}
          />
        )}
      </div>
      <pre
        className="min-w-0 whitespace-pre-wrap wrap-anywhere"
        data-testid="permission-state"
        aria-label="Inline permission caller state"
      >
        {JSON.stringify(
          {
            request,
            pendingCount,
            keyboardShortcutsEnabled,
            inputRevision,
            mounted,
            mountRevision,
            width,
          },
          (_key, value: unknown) => (value === undefined ? '[undefined]' : value),
          2,
        )}
      </pre>
    </section>
  );
}
