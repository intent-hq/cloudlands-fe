// i18n-ignore (internal unreleased preview controls and explicit caller values)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RepositoryPickerRow } from '@/features/workspace/components/repository-picker-row';

export function RepositoryPickerRowExamples() {
  const [disabled, setDisabled] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [owner, setOwner] = useState(true);
  const [avatar, setAvatar] = useState(true);
  const [option, setOption] = useState(false);
  const [selected, setSelected] = useState(false);
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const revision = updated ? 'updated' : 'original';
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="repository-row-demo">
      <header>
        <h2>Repository picker row</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable row
        </Button>
        <Button variant="outline" aria-pressed={updated} onClick={() => setUpdated(!updated)}>
          Replace repository
        </Button>
        <Button variant="outline" aria-pressed={owner} onClick={() => setOwner(!owner)}>
          Show owner
        </Button>
        <Button variant="outline" aria-pressed={avatar} onClick={() => setAvatar(!avatar)}>
          Use local avatar
        </Button>
        <Button variant="outline" aria-pressed={option} onClick={() => setOption(!option)}>
          Use option role
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show repository row
        </Button>
      </div>
      <Button variant="outline">Before repository</Button>
      <div
        role={option ? 'listbox' : undefined}
        aria-label={option ? 'Repository choices' : undefined}
        className="min-w-0"
        data-testid="repository-row-frame"
      >
        {visible && (
          <RepositoryPickerRow
            data-testid="repository-row"
            className="w-full"
            owner="intent-preview"
            name={
              updated ? 'long-repository-name-for-narrow-workspace-layouts' : 'sample-repository'
            }
            suffix={updated ? undefined : 'private'}
            provider="gitlab"
            avatarUrl={avatar ? '/favicon.png' : undefined}
            showOwner={owner}
            showForge
            recent
            option={option}
            selected={selected}
            aria-selected={option ? selected : undefined}
            disabled={disabled}
            onClick={() => {
              setSelected(!selected);
              setEvents((previous) => [...previous, revision]);
            }}
          />
        )}
      </div>
      <Button variant="outline">After repository</Button>
      <output aria-label="Repository row callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
