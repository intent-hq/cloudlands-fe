let current: Set<() => void> | undefined;

/** The lifecycle read saga owns the lifetime of delayed task-event work. */
export function installTaskEventCompletionOwner(): () => void {
  const previous = current;
  for (const finish of [...(previous ?? [])]) finish();
  previous?.clear();
  const pending = new Set<() => void>();
  current = pending;
  return () => {
    if (current === pending) current = undefined;
    for (const finish of [...pending]) finish();
    pending.clear();
  };
}

export function retainTaskEventCompletion(finish: () => void): () => void {
  const pending = current;
  if (!pending) {
    finish();
    return () => {};
  }
  pending.add(finish);
  return () => {
    pending.delete(finish);
  };
}
