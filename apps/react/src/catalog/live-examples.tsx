// Real backend callers. Application startup owns transport and saga lifetimes.
// i18n-ignore (internal catalog exercise controls, not product copy)
import { useEffect, useRef, useState } from 'react';
import { DirectoryPickerModal } from '@/features/onboarding/messages/directory-picker-modal';
import { LinkTooltip, createLinkTooltipHandler } from '@/components/ui/link-tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MemoryLiveExample } from './memory-live-example';

function DirectoryPickerLiveExample({ search }: { search: URLSearchParams }) {
  const [initialPath, setInitialPath] = useState(() => search.get('initialPath') ?? '');
  const [fileMode, setFileMode] = useState(() => search.get('mode') === 'file');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [selections, setSelections] = useState(0);
  const [closes, setCloses] = useState(0);
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      data-functional-example="live-directory-picker"
    >
      <h2>Live directory picker</h2>
      <Input
        aria-label="Initial directory path"
        value={initialPath}
        onChange={(event) => setInitialPath(event.currentTarget.value)}
      />
      <Switch aria-label="Select files" checked={fileMode} onCheckedChange={setFileMode} />
      <Button onClick={() => setOpen(true)}>Open live directory picker</Button>
      <DirectoryPickerModal
        open={open}
        initialPath={initialPath}
        mode={fileMode ? 'file' : 'directory'}
        onSelect={(path) => {
          setSelected(path);
          setSelections((count) => count + 1);
          setOpen(false);
        }}
        onClose={() => {
          setCloses((count) => count + 1);
          setOpen(false);
        }}
      />
      <output className="break-all" aria-label="Selected live path">
        {selected}
      </output>
      <output aria-label="Live selection count">{selections}</output>
      <output aria-label="Live picker close count">{closes}</output>
      <output aria-label="Live picker open">{String(open)}</output>
    </section>
  );
}

function LinkTooltipLiveExample({ search }: { search: URLSearchParams }) {
  const [url, setUrl] = useState(() => search.get('url') ?? '');
  const [alternateUrl, setAlternateUrl] = useState(() => search.get('alternateUrl') ?? '');
  const [workspaceId, setWorkspaceId] = useState(() => search.get('workspaceId') ?? '');
  const [context, setContext] = useState({ url, alternateUrl, workspaceId });
  const [anchorsVisible, setAnchorsVisible] = useState(true);
  const [hostMounted, setHostMounted] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hostMounted || !container.current) return;
    return createLinkTooltipHandler(container.current);
  }, [hostMounted]);
  return (
    <section className="grid min-w-0 grid-cols-1 gap-4" data-functional-example="live-link-tooltip">
      <h2>Live link preview</h2>
      <Input
        aria-label="Forge URL"
        value={url}
        onChange={(event) => setUrl(event.currentTarget.value)}
      />
      <Input
        aria-label="Alternate forge URL"
        value={alternateUrl}
        onChange={(event) => setAlternateUrl(event.currentTarget.value)}
      />
      <Input
        aria-label="Workspace ID"
        value={workspaceId}
        onChange={(event) => setWorkspaceId(event.currentTarget.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setContext({ url, alternateUrl, workspaceId })}>
          Apply link context
        </Button>
        <Button variant="outline" onClick={() => setAnchorsVisible((visible) => !visible)}>
          {anchorsVisible ? 'Remove link anchors' : 'Restore link anchors'}
        </Button>
        <Button variant="outline" onClick={() => setHostMounted((mounted) => !mounted)}>
          {hostMounted ? 'Unmount tooltip host' : 'Mount tooltip host'}
        </Button>
      </div>
      <div
        ref={container}
        data-workspace-surface={context.workspaceId || undefined}
        className="flex flex-wrap gap-4"
      >
        {anchorsVisible && context.url && <a href={context.url}>Preview supplied link</a>}
        {anchorsVisible && context.alternateUrl && (
          <a href={context.alternateUrl}>Preview alternate link</a>
        )}
      </div>
      {hostMounted && <LinkTooltip />}
      <output className="break-all" aria-label="Live link context">
        {JSON.stringify(context)}
      </output>
      <output aria-label="Tooltip host mounted">{String(hostMounted)}</output>
    </section>
  );
}

export function hasLiveExample(slug: string) {
  return slug === 'directory-picker' || slug === 'link-tooltip' || slug === 'diagnostics-audit';
}

export function LiveExamples({ slug, search }: { slug: string; search: URLSearchParams }) {
  return (
    <article className="component-page grid gap-8" data-testid="catalog-live-examples">
      <p className="type-caption text-muted-foreground" data-internal-example>
        {slug === 'diagnostics-audit'
          ? "Internal live memory exercise using the application's real connection. Backend, geometry and pixel acceptance remain pending."
          : "Internal live backend exercise. Supply a daemon-host path or forge URL and workspace context. Uses the application's real connection. Backend, geometry and pixel acceptance remain pending."}
      </p>
      {slug === 'directory-picker' && <DirectoryPickerLiveExample search={search} />}
      {slug === 'link-tooltip' && <LinkTooltipLiveExample search={search} />}
      {slug === 'diagnostics-audit' && <MemoryLiveExample />}
    </article>
  );
}
