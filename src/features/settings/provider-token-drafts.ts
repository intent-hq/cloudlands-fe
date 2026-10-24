// One-shot, mount-owned transfer to the saga. Secrets never enter action history.
const drafts = new Map<string, { sessionId: string; token: string }>();

export function stageProviderToken(requestId: string, sessionId: string, token: string): void {
  drafts.set(requestId, { sessionId, token });
}

export function takeProviderToken(requestId: string, sessionId: string): string | undefined {
  const draft = drafts.get(requestId);
  drafts.delete(requestId);
  return draft?.sessionId === sessionId ? draft.token : undefined;
}

export function clearProviderTokenDrafts(sessionId?: string): void {
  for (const [id, draft] of drafts) {
    if (sessionId === undefined || draft.sessionId === sessionId) drafts.delete(id);
  }
}
