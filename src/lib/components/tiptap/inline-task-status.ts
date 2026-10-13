/** Ordinary inline tasks share the same mouse and keyboard cycle. */
export function nextInlineTaskState(status: string) {
  const next = status === 'todo' ? 'in-progress' : status === 'in-progress' ? 'done' : 'todo';
  return { status: next, checked: next === 'done' };
}
