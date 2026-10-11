// i18n-ignore (internal presentation/callback exercise controls, not released product copy)
import { useState } from 'react';
import type { Note, TaskStatus } from '$shared/types';
import type { WorkspaceStatusPresentationState } from '$lib/components/workspace/utils/workspace-status-presentation';
import { WorkspaceStatusIcon } from '@/components/workspace/workspace-status-icon';
import { DrivingClientIndicator } from '@/components/workspace/driving-client-indicator';
import { TaskStatusProgress } from '@/components/workspace/task-status-progress';
import { FlameGraph } from '@/components/workspace/sidebar/flame-graph';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function Choice<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Select
          value={value}
          items={values.map((item) => ({ value: item, label: item }))}
          onValueChange={(next) => {
            const match = values.find((item) => item === next);
            if (match) onChange(match);
          }}
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
      control={(field) => <Switch {...field} checked={value} onCheckedChange={onChange} />}
    />
  );
}

const workspaceStatuses: readonly WorkspaceStatusPresentationState[] = [
  'failed',
  'blocked',
  'needs_attention',
  'in_progress',
  'waiting',
  'unread',
  'not_started',
  'idle',
  'complete',
  'pr_queued',
  'pr_ready',
  'pr_open',
  'pr_merged',
];

function StatusIconExample() {
  const [status, setStatus] = useState<WorkspaceStatusPresentationState>('in_progress');
  const [decorative, setDecorative] = useState(false);
  const [customSize, setCustomSize] = useState(false);
  const [size, setSize] = useState(24);
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="workspace-status-icon">
      <h2>Workspace status icon inputs</h2>
      <Choice
        label="Workspace status"
        value={status}
        values={workspaceStatuses}
        onChange={setStatus}
      />
      <Flag label="Decorative status icon" value={decorative} onChange={setDecorative} />
      <Flag label="Custom status size" value={customSize} onChange={setCustomSize} />
      <FormField
        label="Status size"
        control={(field) => (
          <Input
            {...field}
            type="number"
            min={1}
            max={128}
            value={size}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (next >= 1 && next <= 128) setSize(next);
            }}
          />
        )}
      />
      <div data-testid="workspace-status-target">
        <WorkspaceStatusIcon
          status={status}
          decorative={decorative}
          size={customSize ? size : undefined}
        />
      </div>
      <output aria-label="Workspace status inputs" className="wrap-anywhere">
        {JSON.stringify({ status, decorative, size: customSize ? size : 'default (14)' })}
      </output>
      <p className="type-caption text-muted-foreground">
        The default exposes an accessible image name; decorative mode hides the icon. Forced colors
        can be checked through the browser. This standalone host does not reproduce the source tab
        contrast host.
      </p>
    </section>
  );
}

function DrivingClientExample() {
  const [mode, setMode] = useState<'own' | 'other' | 'offline' | 'none'>('other');
  const [eligible, setEligible] = useState<'two' | 'own-only' | 'none'>('two');
  const [hasBrowserTabs, setHasBrowserTabs] = useState(true);
  const [hostName, setHostName] = useState('Office Linux');
  const own = { clientId: 'client-preview-own', name: 'Intent Desktop', connected: true };
  const other = {
    clientId: 'client-preview-other-long-identity',
    name: hostName,
    connected: true,
  };
  const props = {
    ownClientId: own.clientId,
    eligibleClients: eligible === 'two' ? [own, other] : eligible === 'own-only' ? [own] : [],
    driving:
      mode === 'none'
        ? null
        : mode === 'own'
          ? own
          : mode === 'offline'
            ? { clientId: 'client-preview-offline', name: hostName, connected: false }
            : other,
    hasBrowserTabs,
  };
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="driving-client-indicator">
      <h2>Driving client display inputs</h2>
      <Choice
        label="Driving client"
        value={mode}
        values={['own', 'other', 'offline', 'none']}
        onChange={setMode}
      />
      <Choice
        label="Eligible clients"
        value={eligible}
        values={['two', 'own-only', 'none']}
        onChange={setEligible}
      />
      <Flag label="Has browser tabs" value={hasBrowserTabs} onChange={setHasBrowserTabs} />
      <FormField
        label="Other host name"
        description="Use whitespace for the ID fallback, or a long name to check containment."
        control={(field) => (
          <Input
            {...field}
            value={hostName}
            onChange={(event) => setHostName(event.currentTarget.value)}
          />
        )}
      />
      <div className="min-w-0" data-testid="driving-client-target">
        <DrivingClientIndicator {...props} />
      </div>
      <output aria-label="Driving client inputs" className="wrap-anywhere">
        {JSON.stringify(props)}
      </output>
      <p className="type-caption text-muted-foreground">
        Hover or focus the indicator for its tooltip. Online modes need a choice of clients and
        browser tabs; offline remains visible without tabs. These local props do not contact
        clients, switch a primary client or mount the seeded source workspace card.
      </p>
    </section>
  );
}

// Exact mixed-status input from source __tests__/TaskStatusProgress.test.ts.
const mixedStatuses: TaskStatus[] = [
  'complete',
  'in_progress',
  'review_required',
  'discussion_needed',
  'blocked',
  'waiting',
  'not_started',
  'cancelled',
];
const statusSets = {
  mixed: mixedStatuses,
  empty: [],
  complete: ['complete'],
  cancelled: ['cancelled'],
} satisfies Record<string, TaskStatus[]>;
const ratios = {
  'source 1/7': 1 / 7,
  'canonical 0.8': 0.8,
  zero: 0,
  negative: -1,
  overflow: 2,
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  undefined: undefined,
};

function TaskProgressExample() {
  const [dataset, setDataset] = useState<keyof typeof statusSets>('mixed');
  const [ratio, setRatio] = useState<keyof typeof ratios>('source 1/7');
  const [loading, setLoading] = useState<'auto' | 'loading' | 'ready'>('auto');
  const [motion, setMotion] = useState(true);
  const [compact, setCompact] = useState(false);
  const [animationKey, setAnimationKey] = useState('workspace-one');
  const [useFallback, setUseFallback] = useState(false);
  const [fallback, setFallback] = useState({ total: 10, completed: 2, inProgress: 3 });
  const props = {
    statuses: statusSets[dataset],
    progress: ratios[ratio],
    loading: loading === 'auto' ? undefined : loading === 'loading',
    motion,
    size: compact ? ('compact' as const) : ('default' as const),
    animationKey,
    fallback: useFallback ? fallback : undefined,
    ariaLabel: 'Task progress',
  };
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="task-status-progress">
      <h2>Task progress inputs</h2>
      <Choice
        label="Task statuses"
        value={dataset}
        values={['mixed', 'empty', 'complete', 'cancelled']}
        onChange={setDataset}
      />
      <Choice
        label="Canonical progress"
        value={ratio}
        values={Object.keys(ratios) as (keyof typeof ratios)[]}
        onChange={setRatio}
      />
      <Choice
        label="Progress loading"
        value={loading}
        values={['auto', 'loading', 'ready']}
        onChange={setLoading}
      />
      <Flag label="Animate progress" value={motion} onChange={setMotion} />
      <Flag label="Compact progress" value={compact} onChange={setCompact} />
      <Flag label="Use fallback counts" value={useFallback} onChange={setUseFallback} />
      {(['total', 'completed', 'inProgress'] as const).map((name) => (
        <FormField
          key={name}
          label={`Fallback ${name}`}
          control={(field) => (
            <Input
              {...field}
              type="number"
              value={fallback[name]}
              onChange={(event) => {
                const next = event.currentTarget.valueAsNumber;
                if (Number.isFinite(next)) setFallback((current) => ({ ...current, [name]: next }));
              }}
            />
          )}
        />
      ))}
      <Button
        onClick={() =>
          setAnimationKey((key) => (key === 'workspace-one' ? 'workspace-two' : 'workspace-one'))
        }
      >
        Switch progress animation key
      </Button>
      <div data-testid="task-progress-target">
        <TaskStatusProgress {...props} />
      </div>
      <output aria-label="Task progress inputs" className="wrap-anywhere">
        {JSON.stringify({ ...props, progress: String(props.progress), loading })}
      </output>
      <p className="type-caption text-muted-foreground">
        Counts describe the segments; the separate caller ratio controls the accessible percentage.
        Auto loading follows an undefined ratio. Same-key input changes allow DOM retention checks;
        changing the key exercises remounting while motion is enabled. The catalog motion preference
        also applies.
      </p>
    </section>
  );
}

// Sparse leaf props match source sidebar/__tests__/FlameGraph.test.ts exactly.
// They are never inserted into a Store or represented as daemon Note responses.
type NoteInput = Pick<Note, 'id' | 'title'> &
  Partial<Pick<Note, 'content' | 'isDefault' | 'parentId' | 'metadata' | 'createdAt'>>;
const sourceSingle = [
  {
    id: 'spec',
    title: 'Spec',
    content: '- [ ] [Build UI](intent://local/task/task-1)',
    isDefault: true,
  },
  {
    id: 'task-1',
    title: 'Build UI',
    parentId: 'spec',
    metadata: { task: { status: 'in_progress' } },
  },
] as NoteInput[];
const sourceFour = [
  {
    id: 'spec',
    title: 'Spec',
    content: [
      '- [x] [Done](intent://local/task/done)',
      '- [/] [Build](intent://local/task/build)',
      '- [/] [Test](intent://local/task/test)',
      '- [ ] [Plan](intent://local/task/plan)',
    ].join('\n'),
    isDefault: true,
  },
  { id: 'done', title: 'Done', parentId: 'spec', metadata: { task: { status: 'complete' } } },
  { id: 'build', title: 'Build', parentId: 'spec', metadata: { task: { status: 'in_progress' } } },
  {
    id: 'test',
    title: 'Test',
    parentId: 'spec',
    metadata: { task: { status: 'review_required' } },
  },
  { id: 'plan', title: 'Plan', parentId: 'spec', metadata: { task: { status: 'not_started' } } },
] as NoteInput[];

// Supplemental ordering/filtering inputs, not a shipped source appearance fixture.
const treeInputs = [
  {
    id: 'spec',
    title: 'Spec',
    isDefault: true,
    content: '[Beta](intent://local/task/beta)\n[Alpha](intent://local/task/alpha)',
    metadata: { task: { status: 'complete' } },
  },
  {
    id: 'alpha',
    title: 'Alpha root',
    parentId: 'spec',
    metadata: { task: { status: 'complete', peerOrder: 1 } },
  },
  {
    id: 'beta',
    title: 'Beta root',
    parentId: 'spec',
    content: '[Second](intent://local/task/second)\n[First](intent://local/task/first)',
    metadata: { task: { status: 'in_progress', peerOrder: 2 } },
  },
  {
    id: 'first',
    title: 'First child',
    parentId: 'beta',
    metadata: { task: { status: 'waiting', peerOrder: 1 } },
  },
  {
    id: 'second',
    title: 'Cancelled duplicate',
    parentId: 'beta',
    metadata: { task: { status: 'cancelled' } },
  },
  {
    id: 'second',
    title: 'Second child',
    parentId: 'beta',
    metadata: { task: { status: 'review_required', peerOrder: 2 } },
  },
  {
    id: 'second',
    title: 'Later duplicate',
    parentId: 'beta',
    metadata: { task: { status: 'complete' } },
  },
  {
    id: 'newer',
    title: 'Newer fallback child',
    parentId: 'beta',
    createdAt: '2026-01-02T00:00:00Z',
    metadata: { task: { status: 'not_started', peerOrder: 3 } },
  },
  {
    id: 'older',
    title: 'Older fallback child',
    parentId: 'beta',
    createdAt: '2026-01-01T00:00:00Z',
    metadata: { task: { status: 'discussion_needed', peerOrder: 3 } },
  },
  {
    id: 'peer',
    title: 'Earlier peer child',
    parentId: 'beta',
    metadata: { task: { status: 'blocked', peerOrder: 0 } },
  },
  {
    id: 'grandchild',
    title: 'Nested descendant',
    parentId: 'second',
    metadata: { task: { status: 'in_progress' } },
  },
  {
    id: 'unlinked',
    title: 'Unlinked root',
    parentId: 'spec',
    metadata: { task: { status: 'not_started', peerOrder: 3 } },
  },
  {
    id: 'cancelled',
    title: 'Cancelled root',
    parentId: 'spec',
    metadata: { task: { status: 'cancelled' } },
  },
  {
    id: 'orphan',
    title: 'Unattached task',
    parentId: 'missing',
    metadata: { task: { status: 'complete' } },
  },
] as NoteInput[];
const longInputs = [
  { id: 'spec', title: 'Spec', content: '', isDefault: true },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `scroll-${index + 1}`,
    title: `Task ${index + 1}: a long title for checking readable labels and access to the final row`,
    parentId: 'spec',
    metadata: { task: { status: 'not_started' as const, peerOrder: index } },
  })),
] as NoteInput[];
const noteSets = {
  'source-single': sourceSingle,
  'source-four': sourceFour,
  'linked-tree': treeInputs,
  'no-links': treeInputs.map((note) => (note.id === 'spec' ? { ...note, content: '' } : note)),
  'missing-spec': sourceSingle.filter((note) => note.id !== 'spec'),
  'long-list': longInputs,
  empty: [],
};

function FlameGraphExample() {
  const [dataset, setDataset] = useState<keyof typeof noteSets>('source-four');
  const [completeBuild, setCompleteBuild] = useState(false);
  const [callback, setCallback] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('0.25');
  const [animationKey, setAnimationKey] = useState('workspace-one');
  const [clicks, setClicks] = useState<string[]>([]);
  const notes = noteSets[dataset].map((note) =>
    completeBuild && note.id === 'build'
      ? { ...note, metadata: { task: { ...note.metadata?.task, status: 'complete' as const } } }
      : note,
  ) as Note[];
  return (
    <section className="grid min-w-0 gap-4" data-functional-example="flame-graph">
      <h2>Flame graph note inputs and callbacks</h2>
      <Choice
        label="Flame note inputs"
        value={dataset}
        values={Object.keys(noteSets) as (keyof typeof noteSets)[]}
        onChange={(next) => {
          setDataset(next);
          setCompleteBuild(false);
          setProgress(next === 'source-single' ? '0.5' : '0.25');
        }}
      />
      <FormField
        label="Flame canonical progress"
        description="Independent caller ratio; leave empty for the undefined input."
        control={(field) => (
          <Input
            {...field}
            value={progress}
            onChange={(event) => setProgress(event.currentTarget.value)}
          />
        )}
      />
      <Flag label="Complete Build locally" value={completeBuild} onChange={setCompleteBuild} />
      <Flag label="Enable note callback" value={callback} onChange={setCallback} />
      <Flag label="Flame loading" value={loading} onChange={setLoading} />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            setAnimationKey((key) => (key === 'workspace-one' ? 'workspace-two' : 'workspace-one'))
          }
        >
          Switch flame animation key
        </Button>
        <Button onClick={() => setClicks([])}>Clear note callbacks</Button>
      </div>
      <div data-testid="flame-graph-target">
        <FlameGraph
          notes={notes}
          progress={progress === '' ? undefined : Number(progress)}
          loading={loading || progress === ''}
          animationKey={animationKey}
          onTaskClick={callback ? (id) => setClicks((current) => [...current, id]) : undefined}
        />
      </div>
      <output aria-label="Flame note callbacks" className="wrap-anywhere">
        {JSON.stringify(clicks)}
      </output>
      <output aria-label="Flame inputs" className="wrap-anywhere">
        {JSON.stringify({
          dataset,
          progress: progress || 'undefined',
          loading,
          callback,
          completeBuild,
          animationKey,
          notes,
        })}
      </output>
      <p className="type-caption text-muted-foreground">
        Hover or focus the bar to reach the real task popup. Its trigger and summary report the spec
        ID; task rows report their own IDs. The source-single and source-four inputs come from
        shipped unit fixtures, whose tooltip was mocked. This exercise uses the actual tooltip and
        does not claim source screenshot equivalence. Other sets are supplemental inputs for
        hierarchy, filtering, ordering and scrolling.
      </p>
    </section>
  );
}

export function WorkspacePresentationExamples({ slug }: { slug: string }) {
  return (
    <div className="grid w-full min-w-0 max-w-full gap-4">
      <p className="type-caption text-muted-foreground">
        Internal leaf exercise with local presentation props. No workspace, note or browser-client
        service is exercised. Native and visual acceptance remain pending; this is not a
        source-equivalent crop.
      </p>
      {slug === 'workspace-status-icon' && <StatusIconExample />}
      {slug === 'driving-client-indicator' && <DrivingClientExample />}
      {slug === 'task-status-progress' && <TaskProgressExample />}
      {slug === 'flame-graph' && <FlameGraphExample />}
    </div>
  );
}
