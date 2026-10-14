// i18n-ignore (internal real-state diagnostic preview)
import { StrictMode, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { HostExecutionNotice } from '@/features/providers/host-execution-notice';
import { selectHostRole } from '@/store/principal/principal-selectors';
import { selectDaemonHealth } from '@/store/daemon-health/daemon-health-selectors';
import { selectHostExecutionGeneration } from '@/store/host-execution/host-execution-selectors';

const kinds = ['git-policy', 'repository', 'ai'] as const;

export function HostExecutionNoticeExamples() {
  const role = selectHostRole();
  const health = selectDaemonHealth();
  const generation = selectHostExecutionGeneration();
  const [kind, setKind] = useState<(typeof kinds)[number]>('git-policy');
  const [visible, setVisible] = useState(true);
  return (
    <section className="grid w-full min-w-0 max-w-lg gap-4" data-testid="host-notice-demo">
      <header>
        <h2>Host execution notice</h2>
        <p className="type-caption text-muted-foreground">
          Internal live-state preview · unreleased
        </p>
      </header>
      <output aria-label="Actual host state">
        {JSON.stringify({ role: role.value, health: health.value, generation: generation.value })}
      </output>
      <div className="flex flex-wrap gap-2">
        {kinds.map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {value}
          </Button>
        ))}
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Mount notice
        </Button>
      </div>
      <div className="min-h-12" data-testid="host-notice-frame">
        <StrictMode>{visible && <HostExecutionNotice kind={kind} />}</StrictMode>
      </div>
      <Link to="/workspaces" search={{}}>
        Open workspaces
      </Link>
    </section>
  );
}
