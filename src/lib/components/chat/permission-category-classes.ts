export function getCategoryColor(category: string): string {
  switch (category) {
    case 'delete':
      return 'text-permission-delete bg-permission-delete/10 border-permission-delete/30';
    case 'write':
      return 'text-warning-ink bg-warning/10 border-warning/30';
    case 'execute':
      return 'text-permission-execute bg-permission-execute/10 border-permission-execute/30';
    case 'read':
      return 'text-permission-read bg-permission-read/10 border-permission-read/30';
    default:
      return 'text-permission-other bg-permission-other/10 border-permission-other/30';
  }
}
