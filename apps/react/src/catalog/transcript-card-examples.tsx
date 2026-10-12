// i18n-ignore (internal, unreleased catalog inputs; product copy remains in the real leaves)
import { useState } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ExecutionPlanCard } from '@/features/chat/components/execution-plan-card';
import { DigestCard } from '@/features/chat/components/digest-card';
import { isPlanContentBlock, type PlanEntry } from '$shared/types/content-block';

const planPresets = {
  mixed: [
    { content: 'Read the request', priority: 'high', status: 'completed' },
    { content: 'Prepare the change', priority: 'medium', status: 'in_progress' },
    { content: 'Review the result', priority: 'low', status: 'pending' },
  ],
  pending: [
    { content: 'Read the request', priority: 'high', status: 'pending' },
    { content: 'Prepare the change', priority: 'medium', status: 'pending' },
    { content: 'Review the result', priority: 'low', status: 'pending' },
  ],
  completed: [
    { content: 'Read the request', priority: 'high', status: 'completed' },
    { content: 'Prepare the change', priority: 'medium', status: 'completed' },
    { content: 'Review the result', priority: 'low', status: 'completed' },
  ],
  'multiple-current': [
    { content: 'Read the request', priority: 'high', status: 'pending' },
    { content: 'Prepare the change', priority: 'medium', status: 'in_progress' },
    { content: 'Review the result', priority: 'low', status: 'in_progress' },
  ],
  long: [
    {
      content:
        'Review the complete transcript and keep every word of this deliberately long plan entry readable when the available frame becomes narrow.',
      priority: 'high',
      status: 'in_progress',
    },
    {
      content: 'UnbrokenPlanContent'.repeat(12),
      priority: 'low',
      status: 'pending',
    },
  ],
  empty: [],
} satisfies Record<string, PlanEntry[]>;

const digestPresets = {
  plain: 'The request was reviewed and the next steps are ready.',
  empty: '',
  literal: '<strong>Keep this literal</strong> & **not Markdown** <script>no script</script>',
  multiline: 'First line of the digest.\n\nSecond paragraph with several words.\nFinal line.',
};

export function TranscriptCardExamples() {
  const [planDraft, setPlanDraft] = useState(JSON.stringify(planPresets.mixed, null, 2));
  const [entries, setEntries] = useState<PlanEntry[]>(planPresets.mixed);
  const [planError, setPlanError] = useState('');
  const [digestDraft, setDigestDraft] = useState(digestPresets.plain);
  const [digest, setDigest] = useState(digestPresets.plain);
  const [planMounted, setPlanMounted] = useState(true);
  const [digestMounted, setDigestMounted] = useState(true);
  const [planMount, setPlanMount] = useState(0);
  const [digestMount, setDigestMount] = useState(0);
  const [width, setWidth] = useState('720');
  const [parentInput, setParentInput] = useState('');

  function applyPlan() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(planDraft);
    } catch {
      setPlanError('Enter valid JSON before applying the plan.');
      return;
    }
    const block = { type: 'plan', entries: parsed };
    if (!isPlanContentBlock(block)) {
      setPlanError(
        'Enter a canonical plan array: each entry needs content, priority and status, within the plan entry limit.',
      );
      return;
    }
    setPlanError('');
    setEntries(block.entries);
  }

  return (
    <section
      className="grid min-w-0 max-w-full grid-cols-1 gap-4"
      data-functional-example="transcript-cards"
      data-testid="transcript-cards-exercise"
      aria-label="Execution plan and digest exercise"
    >
      <h2>Execution plan and digest</h2>
      <p className="min-w-0 wrap-anywhere type-caption text-muted-foreground">
        Internal, unreleased component exercise. Presets fill the draft; Apply sends it to the real
        card. Native behavior, full motion and source appearance remain unverified.
      </p>
      <FormField
        label="Parent input"
        description="Editing this unrelated input rerenders the parent without replacing either card."
        control={(field) => (
          <Input
            {...field}
            className="min-w-0 max-w-full"
            data-testid="transcript-parent-input"
            value={parentInput}
            onChange={(event) => setParentInput(event.target.value)}
          />
        )}
      />
      <FormField
        label="Card frame width"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Card frame width"
            className="min-w-0 max-w-full flex-wrap justify-start"
            data-testid="transcript-width"
            value={width}
            onValueChange={(value) => {
              if (value === '420' || value === '720') setWidth(value);
            }}
          >
            <ToggleGroupItem value="420" data-testid="transcript-width-420">
              420
            </ToggleGroupItem>
            <ToggleGroupItem value="720" data-testid="transcript-width-720">
              720
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <section className="grid min-w-0 max-w-full grid-cols-1 gap-3" aria-label="Plan inputs">
        <FormField
          label="Plan entries JSON"
          description="Content is a string; priority is high, medium or low; status is pending, in_progress or completed."
          error={planError}
          control={(field) => (
            <Textarea
              {...field}
              className="min-w-0 max-w-full"
              data-testid="transcript-plan-json"
              rows={8}
              value={planDraft}
              onChange={(event) => setPlanDraft(event.target.value)}
            />
          )}
        />
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          {Object.entries(planPresets).map(([name, preset]) => (
            <Button
              key={name}
              variant="outline"
              data-testid={`transcript-plan-preset-${name}`}
              onClick={() => setPlanDraft(JSON.stringify(preset, null, 2))}
            >
              Plan: {name}
            </Button>
          ))}
          <Button data-testid="transcript-plan-apply" onClick={applyPlan}>
            Apply plan
          </Button>
        </div>
        <FormField
          label="Plan mounted"
          control={(field) => (
            <Switch
              {...field}
              ariaLabel="Plan mounted"
              data-testid="transcript-plan-mounted"
              checked={planMounted}
              onCheckedChange={setPlanMounted}
            />
          )}
        />
        <div>
          <Button
            data-testid="transcript-plan-remount"
            disabled={!planMounted}
            onClick={() => setPlanMount((value) => value + 1)}
          >
            Remount plan
          </Button>
        </div>
        <div
          className="min-w-0 max-w-full"
          style={{ width: Number(width) }}
          data-testid="transcript-plan-frame"
        >
          {planMounted && <ExecutionPlanCard key={planMount} entries={entries} />}
        </div>
      </section>
      <section className="grid min-w-0 max-w-full grid-cols-1 gap-3" aria-label="Digest inputs">
        <FormField
          label="Digest text"
          control={(field) => (
            <Textarea
              {...field}
              className="min-w-0 max-w-full"
              data-testid="transcript-digest-text"
              rows={4}
              value={digestDraft}
              onChange={(event) => setDigestDraft(event.target.value)}
            />
          )}
        />
        <div className="flex min-w-0 max-w-full flex-wrap gap-2">
          {Object.entries(digestPresets).map(([name, preset]) => (
            <Button
              key={name}
              variant="outline"
              data-testid={`transcript-digest-preset-${name}`}
              onClick={() => setDigestDraft(preset)}
            >
              Digest: {name}
            </Button>
          ))}
          <Button data-testid="transcript-digest-apply" onClick={() => setDigest(digestDraft)}>
            Apply digest
          </Button>
        </div>
        <FormField
          label="Digest mounted"
          control={(field) => (
            <Switch
              {...field}
              ariaLabel="Digest mounted"
              data-testid="transcript-digest-mounted"
              checked={digestMounted}
              onCheckedChange={setDigestMounted}
            />
          )}
        />
        <div>
          <Button
            data-testid="transcript-digest-remount"
            disabled={!digestMounted}
            onClick={() => setDigestMount((value) => value + 1)}
          >
            Remount digest
          </Button>
        </div>
        <div
          className="min-w-0 max-w-full"
          style={{ width: Number(width) }}
          data-testid="transcript-digest-frame"
        >
          {digestMounted && <DigestCard key={digestMount} digest={digest} />}
        </div>
      </section>
    </section>
  );
}
