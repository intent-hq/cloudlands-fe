interface ProjectSelectionWithInitGit {
  type: 'local' | 'github' | 'new';
  initGit?: boolean;
}

export function shouldTreatAsNewRepo(selection: ProjectSelectionWithInitGit): boolean {
  return selection.type === 'new' || selection.initGit === true;
}
