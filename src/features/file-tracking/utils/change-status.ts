export type FileChangeAction = 'create' | 'modify' | 'delete';

export function isRenamedStatus(status?: string): boolean {
  return status === 'renamed' || status === 'R';
}

export function mapStatusToAction(status?: string): FileChangeAction {
  switch (status) {
    case 'added':
    case 'A':
    case '?':
    case '??':
      return 'create';
    case 'deleted':
    case 'D':
      return 'delete';
    default:
      return 'modify';
  }
}
