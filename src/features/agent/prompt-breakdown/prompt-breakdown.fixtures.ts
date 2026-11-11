/** Protocol-shaped `promptBreakdown` wire values for previews. */

type Row = [
  id: string,
  label: string,
  owner: string,
  location: string,
  chars: number,
  hint?: string,
];

function wire(rows: Row[], hiddenSkills: unknown[] = []) {
  const sections = rows.map(([id, label, owner, location, chars, hint]) => ({
    id,
    label,
    owner,
    location,
    chars,
    estTokens: Math.ceil(chars / 4),
    ...(hint ? { controlHint: { kind: 'edit-repo-rules', text: hint } } : {}),
  }));
  const sum = (where: string) =>
    sections.filter((s) => s.location === where).reduce((n, s) => n + s.chars, 0);
  const systemPromptChars = sum('systemPrompt');
  const toolDescriptionChars = sum('toolDescription');
  const totalChars = systemPromptChars + toolDescriptionChars;
  return {
    available: true,
    harnessVersion: '3.12',
    recordedAt: '2026-11-10T12:00:00Z',
    systemPromptChars,
    toolDescriptionChars,
    totalChars,
    estTokens: Math.ceil(totalChars / 4),
    sections,
    hiddenSkills,
  };
}

const shared: Row[] = [
  ['ws-reference', 'Workspace API reference', 'intent', 'toolDescription', 21_400],
  ['doctrine', 'Intent instructions', 'intent', 'systemPrompt', 14_800],
  ['specialist-prompt', 'Specialist prompt', 'user', 'systemPrompt', 4_300],
  ['skills', 'Skills', 'user', 'systemPrompt', 3_100],
  ['repo-config', 'Repo config instructions', 'user', 'systemPrompt', 1_900],
  ['suggested-next-steps', 'Suggested next steps', 'intent', 'systemPrompt', 1_200],
  ['remote-machines', 'Remote machines', 'intent', 'systemPrompt', 900],
  [
    'ask-questions',
    'Asking the user questions',
    'intent',
    'systemPrompt',
    650,
    'Turn off Structured questions in Agent features',
  ],
  ['commit-policy', 'Commit policy', 'intent', 'systemPrompt', 420],
  ['role-reminder', 'Role reminder', 'intent', 'systemPrompt', 240],
];

export const promptBreakdownFixtures = {
  available: wire(
    [
      ...shared,
      [
        'repo-rules',
        'Repo rules: loaded natively by Claude Code',
        'user',
        'provider',
        18_500,
        'Includes AGENTS.md',
      ],
    ],
    [
      {
        name: 'memory',
        reason: 'mcp-server-missing',
        detail: 'needs mcp__memory__',
        fix: "Add the memory MCP server in Intent's MCP settings",
      },
      {
        name: 'xcode-build',
        reason: 'compatibility',
        detail: 'compatibility: macOS',
        fix: 'Runs only where its compatibility field says',
      },
    ],
  ),
  'large-repo-rules': wire([
    ['repo-rules', 'Repo rules', 'user', 'systemPrompt', 96_000, 'Includes AGENTS.md'],
    ...shared,
  ]),
  unavailable: { available: false, reason: 'harness-predates-breakdown' },
};
