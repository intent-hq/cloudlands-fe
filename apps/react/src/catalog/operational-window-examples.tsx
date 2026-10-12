// i18n-ignore (internal, unreleased catalog inputs and caller observations)
import {
  StrictMode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  OperationalPanelProvider,
  useOperationalPanel,
  type OperationalPanelLease,
} from '@/features/chat/components/operational-panel';
import { OperationalWindow } from '@/features/chat/components/operational-window';
import {
  operationalRowKey,
  type OperationalRowDescriptor,
  type OperationalRowSnapshot,
} from '$lib/components/chat/operational-row-window';
import { followBottom, type FollowBottomOptions } from '$lib/utils/smartScroll';
import { cn } from '@/lib/utils';

type ScrollMode = 'panel' | 'nested' | 'document';
type Item = Omit<OperationalRowDescriptor, 'scopeId'> & {
  label: string;
  body: string;
  revision: number;
};
type Observation = Record<string, unknown>;

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
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
          className="min-w-0 max-w-full flex-wrap justify-start"
          value={value}
          onValueChange={(next) => {
            const selected = options.find((option) => option === next);
            if (selected) onChange(selected);
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
      {JSON.stringify(value, null, 2)}
    </output>
  );
}

// Ordinary caller data only. The public owner decides which rows to mount.
function makeItems(scope: string, count: number, revision: number, expanded: boolean): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    key: operationalRowKey(scope, `block-${index + 1}`, 'summary'),
    kind: index % 10 === 9 ? 'content' : index % 2 === 0 ? 'tool' : 'reasoning',
    estimatedHeight: 160,
    label: `${scope} row ${index + 1}`,
    body: expanded
      ? 'Expanded caller content wraps into several lines and changes the measured row height. '.repeat(
          8,
        )
      : 'Short caller content.',
    revision,
  }));
}

function Row({
  item,
  admitted,
  observe,
}: {
  item: Item;
  admitted: boolean;
  observe: (observation: Observation) => void;
}) {
  const [draft, setDraft] = useState('');
  const receipt = { key: item.key, label: item.label, revision: item.revision, admitted };
  return (
    <div
      className="grid min-w-0 grid-cols-1 gap-2 py-2"
      data-caller-row-key={item.key}
      data-item-revision={item.revision}
      data-item-kind={item.kind}
      data-admitted={admitted}
    >
      <p className="wrap-anywhere">
        {item.label} · revision {item.revision}
      </p>
      <p className="wrap-anywhere">{item.body}</p>
      <p>Row callback admission flag: {String(admitted)}</p>
      <FormField
        label={`Notes for ${item.label}`}
        control={(field) => (
          <Input
            {...field}
            value={draft}
            onFocus={(event) => observe({ ...receipt, event: 'focus', trusted: event.isTrusted })}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              observe({
                ...receipt,
                event: 'edit',
                value: event.currentTarget.value,
                trusted: event.isTrusted,
              });
            }}
          />
        )}
      />
      <Button
        variant="outline"
        onClick={(event) =>
          observe({ ...receipt, event: 'activate', draft, trusted: event.isTrusted })
        }
      >
        Observe {item.label}
      </Button>
    </div>
  );
}

function Windows({
  scrollRoot,
  mode,
  scope,
  count,
  revision,
  reversed,
  expanded,
  mounted,
  mountRevision,
  callbackRevision,
}: {
  scrollRoot: RefObject<HTMLDivElement | null>;
  mode: ScrollMode;
  scope: string;
  count: number;
  revision: number;
  reversed: boolean;
  expanded: boolean;
  mounted: boolean;
  mountRevision: number;
  callbackRevision: number;
}) {
  const lifetime = useOperationalPanel();
  const lease = useRef<OperationalPanelLease | null>(null);
  const [snapshot, setSnapshot] = useState<OperationalRowSnapshot | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [following, setFollowing] = useState(false);
  const bottomFollower = useRef<ReturnType<typeof followBottom> | null>(null);
  const followOptions = useRef<FollowBottomOptions>({ follow: false });
  useLayoutEffect(() => {
    followOptions.current = {
      enabled: mode !== 'document',
      follow: following,
      layoutNeutralBottomAnchor: true,
      onFollowChange: setFollowing,
    };
    bottomFollower.current?.update(followOptions.current);
  }, [mode, following]);
  useLayoutEffect(() => {
    const container = scrollRoot.current;
    if (!container) return;
    const action = followBottom(container, followOptions.current);
    bottomFollower.current = action;
    return () => {
      if (bottomFollower.current === action) bottomFollower.current = null;
      action.destroy();
    };
  }, [scrollRoot]);
  useLayoutEffect(() => {
    if (!lifetime) throw new Error('Operational window exercise requires its panel provider.');
    const acquired = lifetime.acquire();
    lease.current = acquired;
    return () => {
      lease.current = null;
      acquired.release();
    };
  }, [lifetime]);
  const scopes = [`${scope}:first`, `${scope}:second`];
  const windows = useMemo(
    () =>
      ['first', 'second'].map((name) => {
        const items = makeItems(`${scope}:${name}`, count, revision, expanded);
        return reversed ? items.reverse() : items;
      }),
    [scope, count, revision, expanded, reversed],
  );
  const readSnapshot = () => {
    if (lease.current) setSnapshot(lease.current.panel.policy.snapshot());
  };
  const observe = (observation: Observation) => {
    setObservations((current) => [
      ...current.slice(-11),
      { ...observation, callbackRevision, mountRevision },
    ]);
    // Reads the real owner during the row interaction; focus remains native.
    readSnapshot();
  };
  return (
    <>
      <div
        ref={scrollRoot}
        data-testid="operational-panel-scroll"
        data-following-bottom={following}
        role={mode === 'document' ? undefined : 'region'}
        aria-label={mode === 'document' ? undefined : 'Operational panel native scroll area'}
        tabIndex={mode === 'document' ? undefined : 0}
        className={cn(
          'grid min-w-0 grid-cols-1 content-start gap-3',
          mode !== 'document' && 'h-80 overflow-y-auto',
        )}
      >
        {mounted &&
          windows.map((items, index) => (
            <section
              key={index}
              aria-label={`${index === 0 ? 'First' : 'Second'} window region`}
              className="min-w-0 max-w-full"
            >
              <h3>{scopes[index]}</h3>
              <div
                data-testid={`operational-scroll-${index}`}
                tabIndex={mode === 'nested' ? 0 : undefined}
                role={mode === 'nested' ? 'region' : undefined}
                aria-label={mode === 'nested' ? `${scopes[index]} native scroll area` : undefined}
                className={cn('min-w-0 max-w-full', mode === 'nested' && 'h-64 overflow-y-auto')}
              >
                <OperationalWindow
                  key={`${scopes[index]}:${mountRevision}`}
                  scope={scopes[index]}
                  items={items}
                  row={(item, admitted) => (
                    <Row item={item} admitted={admitted} observe={observe} />
                  )}
                />
              </div>
            </section>
          ))}
      </div>
      <Button variant="outline" onClick={readSnapshot}>
        Read panel snapshot
      </Button>
      <p>Snapshot records the last row interaction or explicit public owner read.</p>
      <Output label="Operational panel snapshot" value={snapshot} />
      <Output label="Operational row observations" value={observations} />
    </>
  );
}

function Exercise() {
  const [mode, setMode] = useState<ScrollMode>('panel');
  const [scope, setScope] = useState('scope-a');
  const [count, setCount] = useState('60');
  const [revision, setRevision] = useState(0);
  const [callbackRevision, setCallbackRevision] = useState(0);
  const [reversed, setReversed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [mountRevision, setMountRevision] = useState(0);
  const [providerMounted, setProviderMounted] = useState(true);
  const [providerRevision, setProviderRevision] = useState(0);
  const [independentMounted, setIndependentMounted] = useState(false);
  const [independentRevision, setIndependentRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const independentRoot = useRef<HTMLDivElement>(null);
  const getScrollRoot = useCallback(
    () => (mode === 'document' ? undefined : (root.current ?? undefined)),
    [mode],
  );
  const getIndependentScrollRoot = useCallback(
    () => (mode === 'document' ? undefined : (independentRoot.current ?? undefined)),
    [mode],
  );
  const windowProps = {
    mode,
    revision,
    callbackRevision,
    reversed,
    expanded,
    mounted,
    mountRevision,
    count: Number(count),
  };
  return (
    <section
      aria-label="Operational window exercise"
      data-functional-example="operational-window"
      className="grid min-w-0 max-w-full grid-cols-1 gap-3"
    >
      <h2>Operational row windows</h2>
      <p>
        Internal unreleased exercise. Scroll and focus the real rows; native verification is
        separate.
      </p>
      <Choice
        label="Scroll mode"
        value={mode}
        options={['panel', 'nested', 'document']}
        onChange={setMode}
      />
      <Choice
        label="Window scope"
        value={scope}
        options={['scope-a', 'scope-b']}
        onChange={setScope}
      />
      <Choice
        label="Items per window"
        value={count}
        options={['0', '8', '60']}
        onChange={setCount}
      />
      <Toggle label="Reverse item order" checked={reversed} onChange={setReversed} />
      <Toggle label="Expanded row content" checked={expanded} onChange={setExpanded} />
      <Toggle label="Windows mounted" checked={mounted} onChange={setMounted} />
      <Toggle label="Provider mounted" checked={providerMounted} onChange={setProviderMounted} />
      <Toggle
        label="Independent panel mounted"
        checked={independentMounted}
        onChange={setIndependentMounted}
      />
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Replace same-key items
        </Button>
        <Button variant="outline" onClick={() => setCallbackRevision((value) => value + 1)}>
          Replace row callback
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMountRevision((value) => value + 1);
            setMounted(true);
          }}
        >
          Remount windows
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setProviderRevision((value) => value + 1);
            setProviderMounted(true);
          }}
        >
          Remount provider
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setIndependentRevision((value) => value + 1);
            setIndependentMounted(true);
          }}
        >
          Remount independent provider
        </Button>
      </div>
      <Output
        label="Operational caller inputs"
        value={{
          mode,
          scope,
          count: Number(count),
          revision,
          callbackRevision,
          reversed,
          expanded,
          mounted,
          mountRevision,
          providerMounted,
          providerRevision,
          independentMounted,
          independentRevision,
        }}
      />
      <section
        aria-label="Primary operational panel"
        data-testid="operational-window-frame"
        className="min-w-0 max-w-full"
        style={{ width: 420 }}
      >
        {providerMounted && (
          <OperationalPanelProvider key={providerRevision} getScrollRoot={getScrollRoot}>
            <Windows scrollRoot={root} scope={scope} {...windowProps} />
          </OperationalPanelProvider>
        )}
      </section>
      {independentMounted && (
        <section
          aria-label="Independent operational panel"
          data-testid="operational-window-independent-frame"
          className="min-w-0 max-w-full"
          style={{ width: 420 }}
        >
          <OperationalPanelProvider
            key={independentRevision}
            getScrollRoot={getIndependentScrollRoot}
          >
            <Windows scrollRoot={independentRoot} scope={`independent:${scope}`} {...windowProps} />
          </OperationalPanelProvider>
        </section>
      )}
    </section>
  );
}

export function OperationalWindowExamples() {
  return (
    <StrictMode>
      <Exercise />
    </StrictMode>
  );
}
