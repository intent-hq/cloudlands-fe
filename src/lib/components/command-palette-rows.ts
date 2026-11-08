/** Pure row builders and labels for the command palette. */
import { m } from '$shared/paraglide/messages.js';
import type {
  PaletteCategory,
  PaletteRepoItem,
} from '$store/renderer/slices/command-palette/command-palette-results';
import { formatRelativeTime } from '$store/renderer/slices/command-palette/command-palette-utils';
import { knownRepoLastUsedMs } from '$store/renderer/slices/workspace-initializer/utils/known-repos';
import { recentRepoKey } from '$store/renderer/slices/workspace-initializer/utils/recent-repo-key';
import type { WorkspaceInitializerRecentRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';
import {
  getRecentRepoIdentity,
  getRecentRepoSource,
  getRepoFolderName,
} from './workspace/initializer/recent-repo-display';

/**
 * A known repo as a palette row. A local clone and the GitHub/GitLab entry of
 * the same repo stay separate rows, told apart by folder path vs. forge name.
 * `pickedAt` is the last palette pick of this repo (ms), when any.
 */
export function toPaletteRepo(
  repo: WorkspaceInitializerRecentRepo,
  gitlabInstance: string | undefined,
  pickedAt = 0,
): PaletteRepoItem {
  const source = getRecentRepoSource(repo, gitlabInstance);
  const identity = getRecentRepoIdentity(repo, gitlabInstance);
  const local = repo.type === 'local';
  const folder = local ? getRepoFolderName(repo.path) : undefined;
  const fullName = identity?.projectPath ?? (repo.owner ? `${repo.owner}/${repo.name}` : undefined);
  const lastUsedAt = Math.max(knownRepoLastUsedMs(repo), pickedAt);
  return {
    id: recentRepoKey(repo),
    label: fullName ?? folder ?? repo.name,
    aliases: [repo.name, folder].filter((name): name is string => !!name),
    description: local ? repo.path : undefined,
    sourceLabel:
      source === 'gitlab'
        ? 'GitLab' // i18n-ignore (brand name)
        : source === 'github'
          ? 'GitHub' // i18n-ignore (brand name)
          : undefined,
    kind: source === 'folder' ? 'folder' : 'repo',
    lastUsedAt,
    _time: lastUsedAt > 0 ? formatRelativeTime(new Date(lastUsedAt)) : '',
    _repo: repo,
    _repoOwner: identity ? identity.projectPath.split('/').slice(0, -1).join('/') : repo.owner,
    _repoProvider: identity?.provider,
  };
}

const CATEGORY_LABELS: Record<PaletteCategory, () => string> = {
  command: () => m.lib_commandPalette_categoryCommand_label(),
  agent: () => m.lib_commandPalette_categoryAgent_label(),
  note: () => m.lib_commandPalette_categoryNote_label(),
  change: () => m.lib_commandPalette_categoryChange_label(),
  terminal: () => m.lib_commandPalette_categoryTerminal_label(),
  browser: () => m.lib_commandPalette_categoryBrowser_label(),
  file: () => m.lib_commandPalette_categoryFile_label(),
  workspace: () => m.lib_commandPalette_categoryWorkspace_label(),
  repo: () => m.lib_commandPalette_categoryRepo_label(),
  folder: () => m.lib_commandPalette_categoryFolder_label(),
  message: () => m.lib_commandPalette_categoryMessage_label(),
};

/** The small category label a blended row shows. */
export function paletteCategoryLabel(category: PaletteCategory | undefined): string | undefined {
  return category ? CATEGORY_LABELS[category]?.() : undefined;
}

/** Label of a "Show N more …" row (empty palette) or a "See all …" row (blended list). */
export function paletteMoreLabel(item: {
  _seeAll?: boolean;
  _filter?: string;
  _count?: number;
  _itemType?: string;
}): string {
  if (item._seeAll) {
    return item._filter === 'note'
      ? m.lib_commandPalette_seeAllNotes_label()
      : m.lib_commandPalette_seeAllMessages_label();
  }
  const count = item._count ?? 0;
  switch (item._itemType) {
    case 'agent':
      return m.lib_commandPalette_showMoreAgents_label({ count });
    case 'note':
      return m.lib_commandPalette_showMoreNotes_label({ count });
    case 'change':
      return m.lib_commandPalette_showMoreChanges_label({ count });
    case 'terminal':
      return m.lib_commandPalette_showMoreTerminals_label({ count });
    case 'browser':
      return m.lib_commandPalette_showMoreBrowsers_label({ count });
    default:
      return m.lib_commandPalette_showMoreFiles_label({ count });
  }
}
