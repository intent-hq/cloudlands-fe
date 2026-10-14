// i18n-ignore (internal unreleased component preview controls and caller values)
import { useState } from 'react';
import type { WorkspacePRPresentationRow } from '$lib/components/shared/pr-presentation-types';
import { faCodePullRequest } from '$lib/icons/phosphor-icon-definitions';
import { SidebarPrList } from '@/components/workspace/sidebar/sidebar-pr-list';
import { Button } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';

const rows: WorkspacePRPresentationRow[] = [
  {
    identity: 'intent/desktop#42',
    number: 42,
    title: 'Keep the workspace navigation readable on narrow screens',
    url: 'https://example.test/intent/desktop/pull/42',
    repo: 'intent/desktop',
    repoContext: 'desktop',
    status: 'open',
    queued: true,
    statusIcon: faCodePullRequest,
    foregroundClass: 'text-success',
    backgroundClass: 'bg-success/10',
    accessibleStateLabel: 'Queued',
    details: 'Checks passed; waiting in the merge queue.',
    monitorAgentId: undefined,
    monitorOnly: false,
  },
  {
    identity: '43',
    number: 43,
    title: 'Waiting for a pull-request link',
    url: '',
    repo: undefined,
    repoContext: undefined,
    status: 'draft',
    queued: false,
    statusIcon: faCodePullRequest,
    foregroundClass: 'text-muted-foreground',
    backgroundClass: 'bg-muted',
    accessibleStateLabel: 'Draft',
    details: 'No link is available.',
    monitorAgentId: undefined,
    monitorOnly: false,
  },
];

export function SidebarPrListExamples() {
  const [updated, setUpdated] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [visible, setVisible] = useState(true);
  const [retire, setRetire] = useState(false);
  const [events, setEvents] = useState<{ identity: string; title: string; revision: string }[]>([]);
  const revision = updated ? 'updated' : 'original';
  const displayedRows = empty
    ? []
    : updated
      ? rows.map((row) => ({ ...row, title: 'Updated pull request', details: 'Current details.' }))
      : rows;
  const onSelect = (row: WorkspacePRPresentationRow) => {
    setEvents((previous) => [...previous, { identity: row.identity, title: row.title, revision }]);
    if (retire) setVisible(false);
  };
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="sidebar-pr-list-demo">
      <header>
        <h2>Pull-request list</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={retire} onClick={() => setRetire(!retire)}>
          Retire on selection
        </Button>
        <Button variant="outline" onClick={() => setVisible(true)}>
          Show pull-request menu
        </Button>
      </div>
      {visible && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button variant="outline">Choose pull request</Button>
          </Menu.Trigger>
          <Menu.Content aria-label="Pull-request preview" className="w-96">
            <SidebarPrList rows={displayedRows} onSelect={onSelect} />
            <Menu.Separator />
            <Menu.Item closeOnSelect={false} onSelect={() => setUpdated(!updated)}>
              Replace rows and callback
            </Menu.Item>
            <Menu.Item closeOnSelect={false} onSelect={() => setEmpty(!empty)}>
              Toggle empty rows
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      )}
      <div data-testid="static-pr-list">
        <SidebarPrList rows={displayedRows} onSelect={onSelect} interactive={false} />
      </div>
      <output aria-label="Pull-request callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
