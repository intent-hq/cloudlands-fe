import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { WindowSegment } from '$lib/components/chat/operational-panel-core';
import {
  OperationalPanelProvider,
  useOperationalPanel,
  type OperationalPanel,
  type OperationalPanelLifetime,
} from './operational-panel';

type Entry = Parameters<OperationalPanel['attach']>[2][number];
export type OperationalWindowProps<T extends Entry> = {
  items: T[];
  scope: string;
  row: (item: T, admitted: boolean) => ReactNode;
};

type WatchedRow = { node: HTMLDivElement; destroy?: () => void };
type RegisterRow = (key: string, node: HTMLDivElement) => () => void;

function WindowRow({
  rowKey,
  register,
  children,
}: {
  rowKey: string;
  register: RegisterRow;
  children: ReactNode;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) return register(rowKey, node);
    },
    [register, rowKey],
  );
  return (
    <div ref={ref} data-operational-window-key={rowKey} style={{ display: 'flow-root' }}>
      {children}
    </div>
  );
}

function OwnedWindow<T extends Entry>({
  lifetime,
  items,
  scope,
  row,
}: OperationalWindowProps<T> & { lifetime: OperationalPanelLifetime }) {
  const root = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, WatchedRow>());
  const binding = useRef<
    | {
        panel: OperationalPanel;
        items: T[];
        segments: WindowSegment[];
        detach: () => void;
        release: () => void;
      }
    | undefined
  >(undefined);
  const [published, setPublished] = useState<{ items: T[]; segments: WindowSegment[] }>({
    items: [],
    segments: [],
  });
  const register = useCallback<RegisterRow>((key, node) => {
    const rows = nodes.current;
    rows.get(key)?.destroy?.();
    const current: WatchedRow = { node };
    rows.set(key, current);
    // A newly mounted row's ref can replay without replaying its already-mounted
    // window. Re-watch immediately if this key is already attached; new keys
    // wait for the window's layout effect to publish their root ownership first.
    const attached = binding.current;
    if (attached?.items.some((item) => item.key === key))
      current.destroy = attached.panel.watch(node, key).destroy;
    return () => {
      current.destroy?.();
      current.destroy = undefined;
      if (rows.get(key) === current) rows.delete(key);
    };
  }, []);

  // All callback refs have committed before this effect. Attach/update the scope
  // before watching rows so watch captures the actual root/key ownership, even
  // on StrictMode replay and when the same keyed DOM survives a scope change.
  useLayoutEffect(() => {
    const publish = () => {
      const current = binding.current;
      if (!current) return;
      const next = { items: current.items, segments: current.segments };
      setPublished((previous) =>
        previous.items === next.items && previous.segments === next.segments ? previous : next,
      );
    };
    let current = binding.current;
    if (!current) {
      const lease = lifetime.acquire();
      current = {
        panel: lease.panel,
        items,
        segments: [],
        detach: () => {},
        release: lease.release,
      };
      binding.current = current;
      const attached = current;
      current.detach = current.panel.attach(scope, root.current!, items, (segments) => {
        if (binding.current !== attached) return;
        attached.segments = segments;
        publish();
      });
    } else if (current.items !== items) {
      current.items = items;
      current.panel.update(scope, items);
    }
    publish();
    for (const [key, watched] of nodes.current) {
      watched.destroy ??= current.panel.watch(watched.node, key).destroy;
    }
  });

  useLayoutEffect(() => {
    const rows = nodes.current;
    return () => {
      const current = binding.current;
      binding.current = undefined;
      for (const watched of rows.values()) {
        watched.destroy?.();
        watched.destroy = undefined;
      }
      current?.detach();
      current?.release();
    };
  }, [lifetime, scope]);

  return (
    <div ref={root} data-operational-window={scope} style={{ overflowAnchor: 'none' }}>
      {published.segments.map((segment) => {
        if (segment.type === 'spacer')
          return (
            <div
              key={segment.key}
              data-operational-spacer=""
              data-operational-spacer-rows={segment.end - segment.start}
              style={{ height: `${segment.height}px` }}
              aria-hidden="true"
            />
          );
        const item = published.items[segment.start];
        return item ? (
          <WindowRow key={segment.key} rowKey={item.key} register={register}>
            {row(item, segment.admitted)}
          </WindowRow>
        ) : null;
      })}
    </div>
  );
}

export function OperationalWindow<T extends Entry>(props: OperationalWindowProps<T>) {
  const lifetime = useOperationalPanel();
  if (!lifetime)
    return (
      <OperationalPanelProvider>
        <OperationalWindow {...props} />
      </OperationalPanelProvider>
    );
  return <OwnedWindow {...props} lifetime={lifetime} />;
}
