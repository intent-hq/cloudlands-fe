import { m } from '$shared/paraglide/messages.js';
import { SidebarExpandableSearch } from './sidebar-expandable-search';

interface ExpandableFileSearchProps {
  query?: string;
  onQueryChange?: (query: string) => void;
  onKeydown?: (event: KeyboardEvent) => void;
}

export function ExpandableFileSearch({
  query,
  onQueryChange,
  onKeydown,
}: ExpandableFileSearchProps) {
  return (
    <SidebarExpandableSearch
      query={query}
      onQueryChange={onQueryChange}
      scope="files"
      placement="toolbar"
      placeholder={m.workspace_multiSelectSidebar_searchFiles_placeholder()}
      onKeydown={onKeydown}
    />
  );
}
