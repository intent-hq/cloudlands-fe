/**
 * Settings → Machines row order: the saved list order (local first), except
 * that the backend this window is connected to moves right after the local
 * row. Nothing moves when the window uses the local machine or the backend is
 * not in the list.
 */
export function orderMachineRows<T extends { id: string; isLocal: boolean }>(
  rows: readonly T[],
  windowBackendId: string,
): T[] {
  const connected = rows.find((row) => row.id === windowBackendId && !row.isLocal);
  if (!connected) return [...rows];
  const rest = rows.filter((row) => row !== connected);
  const localCount = rest.findIndex((row) => !row.isLocal);
  const split = localCount === -1 ? rest.length : localCount;
  return [...rest.slice(0, split), connected, ...rest.slice(split)];
}
