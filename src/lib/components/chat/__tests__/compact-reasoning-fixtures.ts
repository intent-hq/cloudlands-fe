import type { ContentBlock } from '$shared/types';

export type ReasoningRenderer = 'message' | 'streaming';
export type ReasoningLayout = 'nested' | 'standalone';
export type ReasoningGrowth = 'single' | 'multiple';
export type ReasoningStage = 'titles' | 'body' | 'following' | 'completed';

export const growthBody =
  'The supplied paragraph stays readable.\n\nA second paragraph stays in order.';
export const growthTitles = ['Preparing task plan', 'Checking duplicate tracker issue'];
export const followingTitle = 'Locating collection links';

export function thinking(id: string, text: string): ContentBlock {
  return { type: 'thinking', id, text };
}

export function withReasoningLayout(
  children: ContentBlock[],
  layout: ReasoningLayout,
  completed: boolean,
): ContentBlock[] {
  return [
    ...(layout === 'nested'
      ? [
          { type: 'text', id: 'compact:open', text: '<group:Prepping>' } as ContentBlock,
          thinking('compact:group-title', '# Checking bootstrap needs'),
        ]
      : []),
    ...children,
    ...(completed
      ? [
          {
            type: 'text',
            id: 'compact:answer',
            text: `${layout === 'nested' ? '</group:Prepping>' : ''}Final assistant answer.`,
          } as ContentBlock,
        ]
      : []),
  ];
}

export function titleToolHistory(layout: ReasoningLayout, completed: boolean): ContentBlock[] {
  return withReasoningLayout(
    [
      thinking('compact:first', '**Preparing task plan**\n\n**Checking duplicate tracker issue**'),
      thinking('compact:second', '**Locating collection links**'),
      {
        type: 'tool_use',
        id: 'compact:tool',
        toolCallId: 'compact:call',
        name: 'view',
        input: { path: 'src/example.ts' },
      },
      {
        type: 'tool_result',
        id: 'compact:result',
        tool_use_id: 'compact:call',
        output: 'Paired source result',
      },
      thinking('compact:last', '**Validating renderer output**'),
    ],
    layout,
    completed,
  );
}

export function growingHistory(
  layout: ReasoningLayout,
  shape: ReasoningGrowth,
  stage: ReasoningStage,
): ContentBlock[] {
  const titles = shape === 'single' ? growthTitles.slice(0, 1) : growthTitles;
  const text =
    titles.map((title) => `**${title}**`).join('\n\n') +
    (stage === 'titles' ? '' : `\n\n${growthBody}`);
  return withReasoningLayout(
    [
      thinking('growth:same-block', text),
      ...(stage === 'following' || stage === 'completed'
        ? [thinking('growth:following', `**${followingTitle}**`)]
        : []),
    ],
    layout,
    stage === 'completed',
  );
}
