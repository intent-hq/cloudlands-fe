import { useState, useLayoutEffect } from 'react';
import { ArrowRightIcon, CircleIcon, FolderIcon, PlusIcon, XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { HomeSearch } from '@/features/home/components/home-search';
import { HomeActivityTime } from '@/features/home/components/home-activity-time';
import { selectHomeWorkspaceIds, selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectDesktopWorkspaces } from '@/store/desktop/desktop-selectors';
import type { HomeFilter } from '../../../../../src/features/home/home-model';
import { m } from '$shared/paraglide/messages.js';

/** The source Home workspace browser, bounded to existing-workspace navigation. */
export function DesktopHome({
  onOpen,
  onUnavailable,
}: {
  onOpen: (id: string) => void;
  onUnavailable: (title: string) => void;
}) {
  const workspaces = selectDesktopWorkspaces().value;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HomeFilter>('all');
  const [repository, setRepository] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectWorkspaceById(selectedId ?? '').value;
  const ids = selectHomeWorkspaceIds(query, filter).value;
  const repositories = [...new Set(workspaces.map((w) => w.repositoryName).filter(Boolean))];
  const filters = [
    { id: 'all' as const, label: m.home_filter_all() },
    { id: 'attention' as const, label: m.home_filter_attention() },
    { id: 'running' as const, label: m.home_filter_running() },
    { id: 'archived' as const, label: m.home_filter_archived() },
  ];
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="desktop-home" data-home-page>
      <nav className="desktop-home-sidebar" aria-label={m.home_navigation_label()}>
        <div className="desktop-home-destinations">
          <Button variant="ghost" active>
            {m.home_tab_workspaces()}
          </Button>
          <Button variant="ghost" onClick={() => onUnavailable(m.home_assistant())}>
            {m.home_assistant()}
          </Button>
        </div>
        <Button
          variant="ghost"
          active={!repository}
          className="w-full justify-between mt-5"
          onClick={() => setRepository(null)}
        >
          <span>{m.home_all_repositories()}</span>
          <span>{workspaces.length}</span>
        </Button>
        <div className="mt-5 pl-2 flex items-center gap-2 text-subtle">
          <FolderIcon size={16} />
          <span>{m.menu_window_localBackend_label()}</span>
        </div>
        <div className="pl-7 mt-2">
          {repositories.map((name) => (
            <Button
              key={name}
              variant="ghost"
              active={repository === name}
              className="w-full justify-between"
              onClick={() => setRepository(name!)}
            >
              <span>{name}</span>
              <span>{workspaces.filter((w) => w.repositoryName === name).length}</span>
            </Button>
          ))}
        </div>
      </nav>
      <section className="desktop-home-main">
        <header className="desktop-home-header">
          <Button variant="plain" active>
            {m.home_tab_workspaces()}
          </Button>
          <Button variant="plain" onClick={() => onUnavailable(m.home_tab_prs())}>
            {m.home_tab_prs()}
          </Button>
          <Button variant="plain" onClick={() => onUnavailable(m.home_tab_linear())}>
            {m.home_tab_linear()}
          </Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => onUnavailable(m.home_new_workspace())}>
            <PlusIcon size={14} />
            {m.home_new_workspace()}
          </Button>
        </header>
        <div className="desktop-home-filters">
          <HomeSearch
            value={query}
            onchange={setQuery}
            placeholder={m.layout_activeCard_search_placeholder()}
          />
          <div className="flex-1" />
          <div className="flex rounded-xl bg-sidebar p-1">
            {filters.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant="ghost"
                active={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="px-5">
          {ids.map((id) => (
            <DesktopHomeRow
              key={id}
              workspaceId={id}
              repository={repository}
              selected={id === selectedId}
              onSelect={() => setSelectedId(id)}
              onOpen={() => onOpen(id)}
            />
          ))}
        </div>
      </section>
      {selected && (
        <aside className="desktop-home-preview">
          <header>
            <Button
              variant="plain"
              className="text-lg"
              aria-label={m.home_open_workspace()}
              onClick={() => onOpen(selected.id)}
            >
              {selected.title}
              <ArrowRightIcon size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label={m.ui_tab_close_ariaLabel()}
              onClick={() => setSelectedId(null)}
            >
              <XIcon size={14} />
            </Button>
          </header>
          <output className="p-6 text-ui text-subtle">
            {m.desktop_shell_unported_description()}
          </output>
        </aside>
      )}
    </div>
  );
}
function DesktopHomeRow({
  workspaceId,
  repository,
  selected,
  onSelect,
  onOpen,
}: {
  workspaceId: string;
  repository: string | null;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const workspace = selectWorkspaceById(workspaceId).value;
  if (!workspace || (repository && workspace.repositoryName !== repository)) return null;
  return (
    <Button
      variant="ghost"
      active={selected}
      className="desktop-home-row"
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <FolderIcon size={14} />
      <span className="flex-1 text-left">{workspace.title}</span>
      <CircleIcon size={8} weight="fill" />
      <HomeActivityTime workspace={workspace} />
    </Button>
  );
}
