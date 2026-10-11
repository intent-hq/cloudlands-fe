// Real backend caller. Application startup owns the canonical polling saga.
// i18n-ignore (internal catalog exercise controls, not product copy)
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AgentMemoryBreakdownDialog } from '@/features/layout/components/agent-memory-breakdown-dialog';
import { store } from '@/store';
import {
  agentMemoryBreakdownClosed,
  agentMemoryBreakdownOpened,
} from '../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';

export function MemoryLiveExample() {
  const [open, setOpen] = useState(false);
  const [opens, setOpens] = useState(0);
  const [closes, setCloses] = useState(0);
  useEffect(
    () => () => {
      store.dispatch(agentMemoryBreakdownClosed());
    },
    [],
  );
  return (
    <section className="grid min-w-0 grid-cols-1 gap-4" data-functional-example="live-agent-memory">
      <h2>Live agent memory</h2>
      <Button
        disabled={open}
        onClick={() => {
          store.dispatch(agentMemoryBreakdownOpened());
          setOpen(true);
          setOpens((count) => count + 1);
        }}
      >
        Open live agent memory
      </Button>
      {open && (
        <AgentMemoryBreakdownDialog
          onClose={() => {
            store.dispatch(agentMemoryBreakdownClosed());
            setOpen(false);
            setCloses((count) => count + 1);
          }}
        />
      )}
      <output aria-label="Live memory open">{String(open)}</output>
      <output aria-label="Live memory open count">{opens}</output>
      <output aria-label="Live memory close count">{closes}</output>
    </section>
  );
}
