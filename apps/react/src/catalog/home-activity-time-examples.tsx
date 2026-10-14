// i18n-ignore (internal unreleased component preview controls and explicit caller props)
import { useState } from 'react';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import { Button } from '@/components/ui/button';
import { HomeActivityTime } from '@/features/home/components/home-activity-time';

const workspace: Workspace = {
  id: 'activity-preview' as Workspace['id'],
  title: 'Activity preview',
  branch: 'preview',
  changesets: [],
  timeline: [],
  conversationInfo: [],
  status: WorkspaceStatus.Active,
  createdAt: '2024-01-02T06:30:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
  lastActivity: '2026-10-14T00:00:00Z',
  lastContentActivity: '2025-04-25T12:34:00Z',
};

export function HomeActivityTimeExamples() {
  const [mode, setMode] = useState<'content' | 'created' | 'unknown'>('content');
  const [visible, setVisible] = useState(true);
  const current = {
    ...workspace,
    lastContentActivity: mode === 'content' ? workspace.lastContentActivity : 'invalid',
    createdAt: mode === 'unknown' ? 'invalid' : workspace.createdAt,
  };
  return (
    <section className="grid w-full max-w-lg gap-4" data-testid="home-activity-demo">
      <header>
        <h2>Home activity time</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode('content')}>
          Content activity
        </Button>
        <Button variant="outline" onClick={() => setMode('created')}>
          Creation fallback
        </Button>
        <Button variant="outline" onClick={() => setMode('unknown')}>
          Unknown time
        </Button>
        <Button variant="outline" onClick={() => setVisible(!visible)}>
          Show timestamp
        </Button>
      </div>
      <Button variant="outline">Before timestamp</Button>
      <div
        data-testid="home-activity-frame"
        className="flex min-h-10 items-center justify-center rounded-xl bg-muted p-4"
      >
        {visible && <HomeActivityTime workspace={current} />}
      </div>
      <Button variant="outline">After timestamp</Button>
    </section>
  );
}
