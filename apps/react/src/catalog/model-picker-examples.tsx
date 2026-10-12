// i18n-ignore (internal callback exercise controls and exact callback payloads, not product copy)
import { useEffect, useRef, useState } from 'react';
import {
  ModelPicker,
  type ModelPickerHandle,
  type ModelPickerProps,
} from '@/components/chat/input/model-picker';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  selectContextAvailableProviderIds,
  selectContextProviderEntries,
  selectContextReadinessLoaded,
} from '@/store/provider-catalog/workspace-catalog-selectors';
import { selectDaemonHealth } from '@/store/daemon-health/daemon-health-selectors';
import {
  selectObservedModelProviders,
  selectProviderModelsRequests,
} from '@/store/provider-models/provider-models-selectors';

type ModelChange = NonNullable<ModelPickerProps['onModelChange']>;
type Confirmation = NonNullable<ModelPickerProps['confirmModelChange']>;
type PickRecord = {
  id: number;
  model: Parameters<ModelChange>[0];
  pick: Parameters<ModelChange>[1];
};
type ConfirmationRecord = {
  id: number;
  from: Parameters<Confirmation>[0];
  to: Parameters<Confirmation>[1];
  labels: Parameters<Confirmation>[2];
  result: boolean | 'pending';
};

export function ModelPickerExamples() {
  // The app's existing Signals transform tracks these canonical read-only selectors.
  const availableProviderIds = selectContextAvailableProviderIds().value;
  const providerEntries = selectContextProviderEntries().value;
  const readinessLoaded = selectContextReadinessLoaded().value;
  const daemonHealth = selectDaemonHealth().value;
  const observedProviders = selectObservedModelProviders().value;
  const modelRequests = selectProviderModelsRequests().value;
  const providerOptions = availableProviderIds.map((id) => ({
    value: id,
    label: providerEntries.find((entry) => entry.id === id)?.displayName ?? id,
  }));
  const [providerId, setProviderId] = useState<string | undefined>();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [picks, setPicks] = useState<PickRecord[]>([]);
  const [externalPickId, setExternalPickId] = useState('');
  const [confirmations, setConfirmations] = useState<ConfirmationRecord[]>([]);
  const [confirmationMode, setConfirmationMode] = useState<'accept' | 'refuse' | 'hold'>('accept');
  const [mounted, setMounted] = useState(true);
  const [locked, setLocked] = useState(false);
  const [compact, setCompact] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [showDefaultOption, setShowDefaultOption] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  const [reasoningChanges, setReasoningChanges] = useState<(string | null)[]>([]);
  const [settingsRequests, setSettingsRequests] = useState(0);
  const [refCalls, setRefCalls] = useState<('open' | 'clearFallbackWarning')[]>([]);
  const picker = useRef<ModelPickerHandle | null>(null);
  const nextId = useRef(0);
  const pending = useRef(new Map<number, (accepted: boolean) => void>());
  const pendingCount = confirmations.filter((entry) => entry.result === 'pending').length;
  const lastPick = picks.at(-1);
  const observedPicks = picks.filter(
    (entry): entry is PickRecord & { pick: NonNullable<PickRecord['pick']> } =>
      entry.pick !== undefined,
  );
  const externalPick = observedPicks.find((entry) => String(entry.id) === externalPickId);
  const externalOptions = observedPicks.map((entry) => ({
    value: String(entry.id),
    label: `${entry.pick.providerId} / ${entry.pick.modelId}`,
  }));

  useEffect(() => {
    const held = pending.current;
    // Only leaving the entire exercise releases callbacks. Picker unmount/retarget does not.
    return () => {
      for (const resolve of held.values()) resolve(false);
      held.clear();
    };
  }, []);

  const confirmModelChange: Confirmation = (from, to, labels) => {
    const id = ++nextId.current;
    const result = confirmationMode === 'hold' ? 'pending' : confirmationMode === 'accept';
    setConfirmations((current) => [...current, { id, from, to, labels, result }]);
    if (result !== 'pending') return result;
    return new Promise<boolean>((resolve) => pending.current.set(id, resolve));
  };

  function releaseConfirmation(accepted: boolean) {
    const next = pending.current.entries().next().value;
    if (!next) return;
    const [id, resolve] = next;
    pending.current.delete(id);
    setConfirmations((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, result: accepted } : entry)),
    );
    // The real picker decides whether a released confirmation still belongs to its current scope.
    // Never synthesize a pick or update the selected prop from a confirmation result.
    resolve(accepted);
  }

  return (
    <section
      className="grid gap-4"
      data-functional-example="model-picker-callback"
      data-testid="model-picker-callback"
      aria-label="Model picker callback exercise"
    >
      <h2>Internal model picker callback exercise</h2>
      <p className="type-caption text-muted-foreground">
        Uses the connected app's available providers and model catalogs. Choices stay in this
        exercise. Provider settings requests are recorded below; settings navigation is not
        implemented here. Runtime and visual acceptance remain pending.
      </p>
      <FormField
        label="Provider prop"
        control={(field) => (
          <Select
            items={providerOptions}
            value={providerId ?? ''}
            onValueChange={(id) => {
              if (availableProviderIds.includes(id)) setProviderId(id);
            }}
          >
            <SelectTrigger {...field} data-testid="model-picker-provider">
              <SelectValue placeholder="App's active provider" />
            </SelectTrigger>
            <SelectContent portal>
              <SelectGroup>
                {providerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
      <Button data-testid="model-picker-active-provider" onClick={() => setProviderId(undefined)}>
        Use app's active provider
      </Button>
      <FormField
        label="Model confirmation"
        control={(field) => (
          <ToggleGroup
            id={field.id}
            type="single"
            aria-label="Model confirmation"
            value={confirmationMode}
            className="flex-wrap justify-start"
            onValueChange={(value) => {
              if (value === 'accept' || value === 'refuse' || value === 'hold')
                setConfirmationMode(value);
            }}
          >
            <ToggleGroupItem value="accept" data-testid="model-picker-confirm-accept">
              Accept immediately
            </ToggleGroupItem>
            <ToggleGroupItem value="refuse" data-testid="model-picker-confirm-refuse">
              Refuse immediately
            </ToggleGroupItem>
            <ToggleGroupItem value="hold" data-testid="model-picker-confirm-hold">
              Hold confirmation
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="model-picker-release-true"
          disabled={!pendingCount}
          onClick={() => releaseConfirmation(true)}
        >
          Accept next held confirmation
        </Button>
        <Button
          data-testid="model-picker-release-false"
          disabled={!pendingCount}
          onClick={() => releaseConfirmation(false)}
        >
          Refuse next held confirmation
        </Button>
      </div>
      <div className="flex flex-wrap gap-4">
        <FormField
          label="Picker mounted"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-mounted"
              checked={mounted}
              onCheckedChange={setMounted}
            />
          )}
        />
        <FormField
          label="Picker locked"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-locked"
              checked={locked}
              onCheckedChange={setLocked}
            />
          )}
        />
        <FormField
          label="Compact picker"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-compact"
              checked={compact}
              onCheckedChange={setCompact}
            />
          )}
        />
        <FormField
          label="Deferred update prop"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-deferred"
              checked={deferred}
              onCheckedChange={setDeferred}
            />
          )}
        />
        <FormField
          label="Show default model option"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-show-default"
              checked={showDefaultOption}
              onCheckedChange={setShowDefaultOption}
            />
          )}
        />
        <FormField
          label="Show supported reasoning choices"
          control={(field) => (
            <Switch
              {...field}
              data-testid="model-picker-reasoning"
              checked={showReasoning}
              onCheckedChange={setShowReasoning}
            />
          )}
        />
      </div>
      <p className="type-caption text-muted-foreground">
        Deferred update changes the caller prop only; this exercise has no agent update to defer.
        Held confirmations stay pending when the picker is unmounted or its props change.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="model-picker-open"
          disabled={!mounted}
          onClick={() => {
            if (!picker.current) return;
            picker.current.open();
            setRefCalls((current) => [...current, 'open']);
          }}
        >
          Open picker through ref
        </Button>
        <Button
          data-testid="model-picker-clear-warning"
          disabled={!mounted}
          onClick={() => {
            if (!picker.current) return;
            picker.current.clearFallbackWarning();
            setRefCalls((current) => [...current, 'clearFallbackWarning']);
          }}
        >
          Clear fallback warning through ref
        </Button>
      </div>
      <div data-testid="model-picker-live-host">
        {mounted && (
          <ModelPicker
            ref={picker}
            selectedModel={selectedModel}
            providerId={providerId}
            updateGlobalStore={false}
            updateGlobalDefault={false}
            silentFallback={false}
            showDefaultOption={showDefaultOption}
            isLocked={locked}
            isCompact={compact}
            deferUpdate={deferred}
            showReasoning={showReasoning}
            reasoningEffort={reasoningEffort}
            confirmModelChange={confirmModelChange}
            onModelChange={(model, pick) => {
              const id = ++nextId.current;
              setPicks((current) => [...current, { id, model, pick }]);
              setSelectedModel(model);
            }}
            onReasoningChange={(effort) => {
              setReasoningEffort(effort);
              setReasoningChanges((current) => [...current, effort]);
              return true;
            }}
            onOpenProviderSettings={() => setSettingsRequests((current) => current + 1)}
          />
        )}
      </div>
      <FormField
        label="Previously picked model"
        control={(field) => (
          <Select items={externalOptions} value={externalPickId} onValueChange={setExternalPickId}>
            <SelectTrigger {...field} data-testid="model-picker-observed-pick">
              <SelectValue placeholder="Pick a real model above first" />
            </SelectTrigger>
            <SelectContent portal>
              <SelectGroup>
                {externalOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="model-picker-apply-observed"
          disabled={!externalPick}
          onClick={() => {
            if (externalPick) setSelectedModel(externalPick.model);
          }}
        >
          Apply previously picked model
        </Button>
        <Button data-testid="model-picker-clear-selection" onClick={() => setSelectedModel(null)}>
          Clear local selection to default
        </Button>
      </div>
      <dl className="grid gap-2 break-words" aria-live="polite">
        {[
          ['available-providers', 'Available provider IDs', availableProviderIds],
          ['readiness-loaded', 'Provider readiness loaded', readinessLoaded],
          ['daemon-health', 'Daemon health', daemonHealth],
          ['observed-providers', 'Canonical observed providers', observedProviders],
          ['model-requests', 'Canonical model requests', modelRequests],
          ['provider-prop', 'Provider prop', providerId ?? null],
          ['selection', 'Local selected model', selectedModel],
          ['last-raw', 'Last picked raw model', lastPick?.model ?? null],
          ['last-tuple', 'Last picked tuple', lastPick?.pick ?? null],
          ['picks', 'Model callback history', picks],
          ['confirmations', 'Model confirmation history', confirmations],
          ['pending', 'Pending model confirmations', pendingCount],
          ['mounted-state', 'Picker mounted state', mounted],
          [
            'caller-props',
            'Caller props',
            { locked, compact, deferred, showDefaultOption, showReasoning, confirmationMode },
          ],
          ['reasoning-value', 'Local reasoning value', reasoningEffort],
          ['reasoning-history', 'Reasoning callback history', reasoningChanges],
          ['settings-requests', 'Provider settings request count', settingsRequests],
          ['ref-history', 'Picker ref calls', refCalls],
        ].map(([id, label, value]) => (
          <div key={String(id)}>
            <dt>{String(label)}</dt>
            <dd>
              <output aria-label={String(label)} data-testid={`model-picker-${id}`}>
                {JSON.stringify(value)}
              </output>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
