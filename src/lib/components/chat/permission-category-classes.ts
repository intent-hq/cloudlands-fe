export function getCategoryColor(category: string): string {
  switch (category) {
    case 'delete':
      return 'text-red-500 bg-red-500/10 border-red-500/30';
    case 'write':
      return 'text-warning-ink bg-warning/10 border-warning/30';
    case 'execute':
      return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30';
    case 'read':
      return 'text-blue-500 bg-blue-500/10 border-blue-500/30';
    default:
      return 'text-violet-500 bg-violet-500/10 border-violet-500/30';
  }
}
