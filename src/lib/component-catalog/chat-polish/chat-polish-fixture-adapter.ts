export const chatPolishFixtureAdapter = Object.freeze({
  mode: 'isolated' as const,
  workspaceId: 'fixture-workspace',
  parentAgentId: 'fixture-parent-agent',
  readOnly: true,
  messageProps: Object.freeze({
    workspace: null,
    onEditSubmit: undefined,
    onRegenerate: undefined,
    onFork: undefined,
    onVote: undefined,
    onCopy: undefined,
    onStickyClick: undefined,
  }),
});
