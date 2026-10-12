// i18n-ignore (internal, unreleased catalog controls and caller observations)
import { useState, type ComponentProps } from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DetectedScriptsCard } from '@/features/chat/components/detected-scripts-card';

type Scripts = ComponentProps<typeof DetectedScriptsCard>['scripts'];

const presets = {
  empty: [],
  singular: [{ name: 'Build', command: 'pnpm build', mode: 'command' }],
  service: [{ name: 'Development', command: 'pnpm dev', mode: 'service', category: 'development' }],
  other: [{ name: 'Inspect', command: 'pnpm inspect', mode: 'custom mode', category: 'other' }],
  categories: [
    { name: 'Absent category', command: 'pnpm absent', mode: 'command' },
    { name: 'Empty category', command: 'pnpm empty', mode: 'command', category: '' },
    { name: 'Other category', command: 'pnpm other', mode: 'command', category: 'other' },
    { name: 'Named category', command: 'pnpm named', mode: 'command', category: 'quality' },
    { name: 'Case-sensitive category', command: 'pnpm case', mode: 'Service', category: 'Other' },
  ],
  many: [
    { name: 'Development', command: 'pnpm dev', mode: 'service', category: 'development' },
    { name: 'Build', command: 'pnpm build', mode: 'command', category: 'build' },
    { name: 'Inspect', command: 'pnpm inspect', mode: 'custom mode', category: 'other' },
  ],
  long: [
    {
      name: 'A deliberately long development service name with enough words to wrap in a narrow card',
      command:
        'pnpm run development --filter workspace -- --project ' + 'LongProjectName'.repeat(18),
      mode: 'service',
      category: 'development',
    },
    {
      name: 'UnbrokenScriptName'.repeat(18),
      command: 'pnpm build -- ' + 'LongCommandArgument'.repeat(24),
      mode: 'command',
      category: 'build',
    },
  ],
  literal: [
    {
      name: '<strong>Literal name</strong> & **plain text**',
      command: 'printf "<script>literal text</script>" && echo "**not Markdown**"',
      mode: '',
      category: '<em>literal category</em>',
    },
  ],
} satisfies Record<string, Scripts>;

function isScripts(value: unknown): value is Scripts {
  return (
    Array.isArray(value) &&
    value.every(
      (script) =>
        script !== null &&
        typeof script === 'object' &&
        typeof script.name === 'string' &&
        typeof script.command === 'string' &&
        typeof script.mode === 'string' &&
        (script.category === undefined || typeof script.category === 'string'),
    )
  );
}

export function DetectedScriptExamples() {
  const [scripts, setScripts] = useState<Scripts>(presets.many);
  const [draft, setDraft] = useState(JSON.stringify(presets.many, null, 2));
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(true);
  const [mount, setMount] = useState(0);
  const [width, setWidth] = useState('720');
  const [parentInput, setParentInput] = useState('');

  function applyDraft() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError('Enter valid JSON before applying the scripts.');
      return;
    }
    if (!isScripts(parsed)) {
      setError(
        'Enter an array with string name, command and mode fields, and an optional string category.',
      );
      return;
    }
    setScripts(parsed);
    setError('');
  }

  function loadDraft(next: Scripts) {
    setDraft(JSON.stringify(next, null, 2));
    setError('');
  }

  return (
    <section
      className="grid min-w-0 max-w-full grid-cols-1 gap-4"
      data-functional-example="detected-scripts"
      data-testid="detected-scripts-exercise"
      aria-label="Detected scripts exercise"
    >
      <h2>Detected scripts</h2>
      <p className="type-caption min-w-0 wrap-anywhere text-muted-foreground">
        Internal, unreleased component exercise. Load a draft, then Apply to update the real card.
        Use Customize preview for the catalog’s Light and Dark theme controls. Native behavior and
        source appearance remain unverified.
      </p>
      <FormField
        label="Parent input"
        description="Editing this input rerenders the caller without replacing the card."
        control={(field) => (
          <Input
            {...field}
            data-testid="detected-scripts-parent-input"
            value={parentInput}
            onChange={(event) => setParentInput(event.currentTarget.value)}
          />
        )}
      />
      <FormField
        label="Script frame width"
        control={(field) => (
          <ToggleGroup
            {...field}
            type="single"
            aria-label="Script frame width"
            className="min-w-0 max-w-full flex-wrap justify-start"
            data-testid="detected-scripts-width"
            value={width}
            onValueChange={(value) => {
              if (value === '420' || value === '720') setWidth(value);
            }}
          >
            <ToggleGroupItem value="420" data-testid="detected-scripts-width-420">
              420
            </ToggleGroupItem>
            <ToggleGroupItem value="720" data-testid="detected-scripts-width-720">
              720
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      />
      <FormField
        label="Scripts JSON draft"
        description="Name, command and mode accept any strings. Category is optional. Only the exact mode service gets a service badge; empty and other categories are hidden."
        error={error}
        control={(field) => (
          <Textarea
            {...field}
            data-testid="detected-scripts-json"
            rows={10}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        )}
      />
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        {Object.entries(presets).map(([name, value]) => (
          <Button
            key={name}
            variant="outline"
            data-testid={`detected-scripts-preset-${name}`}
            onClick={() => loadDraft(value)}
          >
            Load {name} draft
          </Button>
        ))}
        <Button
          variant="outline"
          data-testid="detected-scripts-replace-fields"
          disabled={scripts.length === 0}
          onClick={() =>
            loadDraft(
              scripts.map((script) => ({
                ...script,
                mode: script.mode === 'service' ? 'command' : 'service',
                category: script.category === 'verification' ? 'other' : 'verification',
              })),
            )
          }
        >
          Load same-key field changes
        </Button>
        <Button
          variant="outline"
          data-testid="detected-scripts-reverse"
          disabled={scripts.length < 2}
          onClick={() => loadDraft([...scripts].reverse())}
        >
          Load reversed rows
        </Button>
        <Button variant="primary" data-testid="detected-scripts-apply" onClick={applyDraft}>
          Apply scripts
        </Button>
      </div>
      <FormField
        label="Scripts card mounted"
        control={(field) => (
          <Switch
            {...field}
            ariaLabel="Scripts card mounted"
            data-testid="detected-scripts-mounted"
            checked={mounted}
            onCheckedChange={setMounted}
          />
        )}
      />
      <div>
        <Button
          variant="outline"
          data-testid="detected-scripts-remount"
          disabled={!mounted}
          onClick={() => setMount((value) => value + 1)}
        >
          Remount scripts card
        </Button>
      </div>
      <div
        className="min-w-0 max-w-full"
        style={{ width: Number(width) }}
        data-testid="detected-scripts-frame"
      >
        {mounted && <DetectedScriptsCard key={mount} scripts={scripts} />}
      </div>
      <output
        aria-label="Detected scripts caller state"
        data-testid="detected-scripts-state"
        className="block max-h-64 min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere"
      >
        {JSON.stringify({ mounted, mount, width, scriptCount: scripts.length, scripts }, null, 2)}
      </output>
    </section>
  );
}
