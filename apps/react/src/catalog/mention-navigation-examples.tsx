// i18n-ignore (deterministic internal catalog controls and fixture content, not product copy)
// Ordinary caller props, following mention-results.preview's NON-composer branch.
// No mention service replacement, editor, Store seeding, or daemon is involved.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Public Input renders the native input for each editor-owned combobox. */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentBadge } from '@/components/ui/indicators';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  EnhancedMentionList,
  type EnhancedMentionListHandle,
} from '@/features/chat/components/input/enhanced-mention-list';
import { MentionAgentAvatar } from '@/features/chat/components/input/mention-agent-avatar';
import {
  SlashSkillSuggestionList,
  type SlashSkillSuggestionListHandle,
} from '@/features/chat/components/input/slash-skill-suggestion-list';
import type { MentionCandidate, MentionGroup } from '$lib/services/mentions/types';
import type { SkillInfo } from '../../../../src/store/renderer/slices/skills/skills-types';

// Same mixed candidates as the source preview; these strings do not prove live session state.
const mixed: MentionCandidate[] = [
  {
    id: 'mention-preview-agent',
    type: 'agent',
    label: 'Developer',
    subtitle: 'Developer · idle · 12 messages',
    uri: 'devspace://agent/mention-preview-agent',
    group: 'Agents',
  },
  {
    id: 'specialist-developer',
    type: 'specialist',
    label: 'Developer',
    subtitle: 'Plans and implements development tasks with focused verification.',
    uri: 'devspace://specialist/developer',
    group: 'Specialists',
    meta: { promptToken: 'specialist/developer' },
  },
  {
    id: 'file-developer-guide',
    type: 'file',
    label: 'DEVELOPER_GUIDE.md',
    subtitle: 'packages/application/src/features/developer/documentation/DEVELOPER_GUIDE.md',
    uri: 'file://packages/application/src/features/developer/documentation/DEVELOPER_GUIDE.md',
    group: 'Files',
  },
  {
    id: 'script-development',
    type: 'script',
    label: 'Development preview service',
    subtitle: 'Running · pnpm --filter application run development --host 127.0.0.1 --port 5872',
    uri: 'devspace://script/development',
    group: 'Scripts',
  },
  {
    id: 'file-long',
    type: 'file',
    label: 'developer-preview-component-with-a-very-long-unbroken-filename.svelte',
    subtitle: 'src/features/developer/components/preview',
    uri: 'file://src/features/developer/components/preview/long.svelte',
    group: 'Files',
  },
];
const flat: MentionCandidate[] = [
  { id: 'flat-file', type: 'file', label: 'Flat file', uri: 'file://fixture/flat.ts' },
  { id: 'flat-note', type: 'note', label: 'Flat note', uri: 'devspace://note/flat-note' },
  { id: 'flat-task', type: 'task', label: 'Flat task', uri: 'devspace://task/flat-task' },
];
// Source isMentionGroup detects items/subgroups. The source controller follows items only.
// This ordinary intersection satisfies its candidate-typed items without casts or API changes.
const nestedFolder: MentionCandidate & MentionGroup = {
  id: 'nested-folder',
  type: 'group',
  label: 'Nested files',
  uri: 'file://fixture/nested',
  items: [
    { id: 'nested-file', type: 'file', label: 'Nested file', uri: 'file://fixture/nested/file.ts' },
    { id: 'nested-note', type: 'note', label: 'Nested note', uri: 'devspace://note/nested-note' },
  ],
};
const lists: Record<string, (MentionCandidate | MentionGroup)[]> = {
  grouped: mixed,
  flat,
  nested: [{ id: 'root-folder', label: 'Fixture folder', items: [nestedFolder, flat[0]] }],
  many: Array.from({ length: 24 }, (_, index) => ({
    ...mixed[2],
    id: `file-${index}`,
    label: `developer-module-${index}.ts`,
  })),
  empty: [],
  replacement: [
    {
      id: 'replacement-note',
      type: 'note',
      label: 'Replacement note',
      uri: 'devspace://note/replacement-note',
    },
  ],
};
const skills: SkillInfo[] = [
  {
    name: 'fixture-review',
    description: 'Deterministic review skill prop',
    location: '/fixture/skills/review/SKILL.md',
    scope: 'project',
  },
  {
    name: 'fixture-plan',
    description: 'Deterministic planning skill prop',
    location: '/fixture/skills/plan/SKILL.md',
    scope: 'user',
  },
];

function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Select
          value={value}
          items={values.map((item) => ({ value: item, label: item }))}
          onValueChange={onChange}
        >
          <SelectTrigger {...field} aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent portal>
            <SelectGroup>
              {values.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}

function Flag({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={checked} onCheckedChange={onChange} />
      )}
    />
  );
}

type KeyRecord = { key: string; handled: boolean; defaultPrevented: boolean; native: boolean };
function forwardKey(
  event: ReactKeyboardEvent<HTMLInputElement>,
  handle: EnhancedMentionListHandle | SlashSkillSuggestionListHandle | null,
): KeyRecord {
  const handled = handle?.onKeyDown({ event: event.nativeEvent }) ?? false;
  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }
  return {
    key: event.key,
    handled,
    defaultPrevented: event.nativeEvent.defaultPrevented,
    native: event.nativeEvent instanceof KeyboardEvent,
  };
}

function MentionExercise() {
  const [scenario, setScenario] = useState('grouped');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [closed, setClosed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [selections, setSelections] = useState<MentionCandidate[]>([]);
  const [closeCallbacks, setCloseCallbacks] = useState(0);
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [activeOption, setActiveOption] = useState<string>();
  const [activeCallbacks, setActiveCallbacks] = useState<(string | null)[]>([]);
  const list = useRef<EnhancedMentionListHandle>(null);
  // Memoization keeps unrelated callback renders from replacing the ordinary items prop.
  const items = useMemo(
    () =>
      lists[scenario].filter((item) =>
        `${item.label} ${'subtitle' in item ? (item.subtitle ?? '') : ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [scenario, query],
  );
  const activeChanged = useCallback((id: string | undefined) => {
    setActiveOption(id);
    setActiveCallbacks((current) => [...current, id ?? null]);
  }, []);
  const visible = mounted && !closed;

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      data-testid="mention-exercise"
    >
      <h3>Mention list caller</h3>
      <Choice
        label="Mention list props"
        value={scenario}
        values={Object.keys(lists)}
        onChange={setScenario}
      />
      <Flag label="Loading mentions" checked={loading} onChange={setLoading} />
      <Flag label="Mount mention list" checked={mounted} onChange={setMounted} />
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button onClick={() => setClosed(false)}>Reopen mentions</Button>
        <Button
          onClick={() => {
            setGeneration((current) => current + 1);
            setMounted(true);
            setClosed(false);
          }}
        >
          Remount mentions
        </Button>
        <Button onClick={() => setScenario('replacement')}>Replace mention props</Button>
        <Button onClick={() => setQuery('')}>Clear mention query</Button>
      </div>
      <FormField
        label="Filter mentions"
        control={(field) => (
          <Input
            {...field}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={visible && activeOption ? 'exercise-mention-listbox' : undefined}
            aria-activedescendant={visible ? activeOption : undefined}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              const entry = forwardKey(event, list.current);
              setKeys((current) => [...current, entry]);
            }}
          />
        )}
      />
      {visible && (
        <EnhancedMentionList
          key={generation}
          ref={list}
          items={items}
          loading={loading}
          listboxId="exercise-mention-listbox"
          onActiveOptionChange={activeChanged}
          command={(item) => setSelections((current) => [...current, item])}
          onClose={() => {
            setClosed(true);
            setCloseCallbacks((current) => current + 1);
          }}
        />
      )}
      <output
        aria-label="Mention callback state"
        data-testid="mention-callback-state"
        className="block min-w-0 whitespace-pre-wrap wrap-anywhere"
      >
        {JSON.stringify(
          {
            scenario,
            query,
            loading,
            mounted,
            closed,
            generation,
            selections,
            activeOption: visible ? (activeOption ?? null) : null,
            activeCallbacks,
            closeCallbacks,
            keys,
          },
          null,
          2,
        )}
      </output>
    </section>
  );
}

function SkillExercise() {
  const [mode, setMode] = useState('ready');
  const [query, setQuery] = useState('');
  const [mounted, setMounted] = useState(true);
  const [closed, setClosed] = useState(false);
  const [selections, setSelections] = useState<SkillInfo[]>([]);
  const [dismissCallbacks, setDismissCallbacks] = useState(0);
  const [retryCallbacks, setRetryCallbacks] = useState(0);
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [activeOption, setActiveOption] = useState<string>();
  const list = useRef<SlashSkillSuggestionListHandle>(null);
  const items = useMemo(
    () =>
      mode === 'empty' ? [] : skills.filter((item) => item.name.includes(query.toLowerCase())),
    [mode, query],
  );
  const visible = mounted && !closed;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" data-testid="skill-exercise">
      <h3>Existing skill list caller</h3>
      <Choice
        label="Skill list props"
        value={mode}
        values={['ready', 'loading', 'error', 'empty']}
        onChange={setMode}
      />
      <Flag label="Mount skill list" checked={mounted} onChange={setMounted} />
      <Button onClick={() => setClosed(false)}>Reopen skills</Button>
      <FormField
        label="Filter skills"
        control={(field) => (
          <Input
            {...field}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={visible && activeOption ? 'exercise-skill-listbox' : undefined}
            aria-activedescendant={visible ? activeOption : undefined}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              const entry = forwardKey(event, list.current);
              setKeys((current) => [...current, entry]);
            }}
          />
        )}
      />
      {visible && (
        <SlashSkillSuggestionList
          ref={list}
          items={items}
          loading={mode === 'loading'}
          error={mode === 'error' ? 'Deterministic error prop' : null}
          listboxId="exercise-skill-listbox"
          onActiveOptionChange={setActiveOption}
          onSelect={(item) => setSelections((current) => [...current, item])}
          onDismiss={() => {
            setClosed(true);
            setDismissCallbacks((current) => current + 1);
          }}
          onRetry={() => {
            setRetryCallbacks((current) => current + 1);
            setMode('ready');
          }}
        />
      )}
      <output
        aria-label="Skill callback state"
        data-testid="skill-callback-state"
        className="block min-w-0 whitespace-pre-wrap wrap-anywhere"
      >
        {JSON.stringify(
          {
            mode,
            query,
            mounted,
            closed,
            selections,
            activeOption: visible ? (activeOption ?? null) : null,
            dismissCallbacks,
            retryCallbacks,
            keys,
          },
          null,
          2,
        )}
      </output>
    </section>
  );
}

export function MentionNavigationExamples() {
  const [count, setCount] = useState('1');
  const [mounted, setMounted] = useState(true);
  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5"
      data-functional-example="mention-navigation"
    >
      <h2>Mention navigation and callbacks</h2>
      <p className="type-caption text-muted-foreground">
        Internal deterministic caller props, following the source preview’s non-composer path.
        Fixture agent IDs and subtitles do not prove live session metadata. No search service,
        editor or daemon is mounted. Native, visual and service acceptance remain unverified.
      </p>
      <MentionExercise />
      <SkillExercise />
      <section
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
        data-testid="mention-agent-leaves"
      >
        <h3>Agent presentation props</h3>
        <Choice
          label="Badge count prop"
          value={count}
          values={['0', '1', '2', '12', '1000']}
          onChange={setCount}
        />
        <Flag label="Mount agent leaves" checked={mounted} onChange={setMounted} />
        {mounted && (
          <div className="flex min-w-0 items-center gap-2">
            <MentionAgentAvatar agentId="mention-preview-agent" />
            <AgentBadge count={Number(count)} />
          </div>
        )}
        <output
          aria-label="Agent leaf props"
          className="block min-w-0 whitespace-pre-wrap wrap-anywhere"
        >
          {JSON.stringify(
            { agentId: 'mention-preview-agent', count: Number(count), mounted },
            null,
            2,
          )}
        </output>
      </section>
    </section>
  );
}
