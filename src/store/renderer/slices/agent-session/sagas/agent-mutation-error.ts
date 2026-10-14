export function mutationError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(error ? String(error) : fallback);
}
