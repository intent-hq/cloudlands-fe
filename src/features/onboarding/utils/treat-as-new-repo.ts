interface ProjectSelectionWithInitGit {
  type: 'local' | 'github' | 'new';
  initGit?: boolean;
  /** Plain-folder selection (Labs): never initialized as a git repository. */
  plainFolder?: 'existing' | 'new';
}

export function shouldTreatAsNewRepo(selection: ProjectSelectionWithInitGit): boolean {
  if (selection.plainFolder) return false;
  return selection.type === 'new' || selection.initGit === true;
}
