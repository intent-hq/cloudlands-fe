// Source: src/lib/components/CommandPaletteItemTitle.svelte.
import { m } from '$shared/paraglide/messages.js';

export interface CommandPaletteItemTitleProps {
  item: {
    type?: string;
    label?: string;
    description?: string;
    breadcrumbs?: string;
    path?: string;
    workspaceName?: string;
    repoLabel?: string;
    isArchivedWorkspace?: boolean;
    _time?: string;
  };
}

export function CommandPaletteItemTitle({ item }: CommandPaletteItemTitleProps) {
  const context =
    item.type === 'note' && item.breadcrumbs
      ? item.breadcrumbs
      : item.type === 'change' || item.type === 'file'
        ? item.path || item.description
        : item.description;
  const detail = [
    ...((item.type === 'message' || item.type === 'note') && item.workspaceName
      ? [item.workspaceName, item.repoLabel]
      : []),
    context,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className="flex min-w-0 items-center gap-2 whitespace-nowrap"
      title={[item.label, detail].filter(Boolean).join(' — ')}
    >
      {(item.type === 'message' || item.type === 'note') && item.isArchivedWorkspace && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 type-caption text-muted-foreground">
          {m.lib_commandPalette_archivedWorkspace_pill()}
        </span>
      )}
      <span
        className={`min-w-0 truncate type-body text-foreground ${detail ? 'min-[480px]:max-w-[65%]' : ''}`}
      >
        {item.label}
      </span>
      {detail && (
        <span className="min-w-0 flex-1 truncate type-caption text-muted-foreground max-[479px]:sr-only">
          {(item.type === 'message' || item.type === 'note') && item.workspaceName && (
            <span aria-hidden="true">·</span>
          )}{' '}
          {detail}
        </span>
      )}
      {item._time && (
        <span className="ml-auto shrink-0 type-caption text-muted-foreground">{item._time}</span>
      )}
    </span>
  );
}
