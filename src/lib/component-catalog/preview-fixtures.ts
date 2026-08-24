export const PREVIEW_FIXTURE_IDS = Object.freeze({
  workspace: 'preview-workspace-primary',
  panel: 'preview-panel-primary',
  agent: 'preview-agent-primary',
  session: 'preview-session-primary',
  thread: 'preview-thread-primary',
  message: 'preview-message-primary',
  note: 'preview-note-primary',
  task: 'preview-task-primary',
});

export const PREVIEW_FIXTURE_TIMESTAMPS = Object.freeze({
  createdAt: '2026-08-23T12:00:00.000Z',
  lastActivity: '2026-08-23T12:04:00.000Z',
  updatedAt: '2026-08-23T12:05:00.000Z',
});

export function definePreviewFixture<T extends object>(fixture: T): (overrides?: Partial<T>) => T {
  return (overrides = {}) => ({ ...fixture, ...overrides });
}
