import type { ContentBlock } from '$shared/types/content-block';

/**
 * Synthetic fixtures for the message render corpus.
 *
 * `knownBad` marks fixtures whose CURRENT rendering is a documented bug.
 * Their goldens lock in the broken output and are expected to change when the
 * corresponding fix lands (update the golden + drop the marker in the fix PR).
 * The `bad-*` fixtures below were the intent-hq/monorepo#2689 cases (tag
 * literals inside code regions scanned as real tags); the parser fix flipped
 * their goldens to correct output and they now double as regression coverage.
 */
export interface SyntheticFixture {
  id: string;
  note: string;
  knownBad?: string;
  blocks: ContentBlock[];
}

const text = (t: string): ContentBlock => ({ type: 'text', text: t });

export const syntheticFixtures: SyntheticFixture[] = [
  {
    id: 'group-simple',
    note: 'well-formed group open/close around prose',
    blocks: [text('<group:Investigating>\nlooking at the parser now\n</group>\n\nAll done.')],
  },
  {
    id: 'group-unclosed-settled',
    note: 'unclosed group in a settled message',
    blocks: [text('<group:Working>\nstill inside the group at end of message')],
  },
  {
    id: 'group-multiple-autoclose',
    note: 'second group open auto-closes the first',
    blocks: [text('<group:First>\nalpha work\n<group:Second>\nbeta work\n</group>\ntail prose')],
  },
  {
    id: 'group-wrapping-tools',
    note: 'group spanning tool_use/tool_result blocks',
    blocks: [
      text('<group:Running checks>\nkicking off the build\n'),
      { type: 'tool_use', id: 't1', name: 'launch-process', input: { command: 'make check' } },
      { type: 'tool_result', tool_use_id: 't1', output: 'ok' } as ContentBlock,
      text('build passed\n</group>\nSummary: everything green.'),
    ],
  },
  {
    id: 'think-simple',
    note: 'well-formed think block',
    blocks: [text('<think>weighing two approaches here</think>\nGoing with approach A.')],
  },
  {
    id: 'thinking-alias',
    note: '<thinking> alias tags',
    blocks: [text('<thinking>internal reasoning</thinking>\nVisible answer.')],
  },
  {
    id: 'think-across-blocks',
    note: 'think opened in one text block, closed in a later one, tool between',
    blocks: [
      text('<think>first half of the thought'),
      { type: 'tool_use', id: 't1', name: 'view', input: { path: 'foo.ts' } },
      text('second half</think>\nDone thinking.'),
    ],
  },
  {
    id: 'stray-group-close',
    note: 'stray </group> in prose is silently consumed (current behavior)',
    blocks: [text('Before the stray tag.\n</group>\nAfter the stray tag.')],
  },
  {
    id: 'stray-think-close',
    note: 'stray </think> in prose is silently consumed (current behavior)',
    blocks: [text('Before stray close.\n</think>\nAfter stray close.')],
  },
  {
    id: 'group-malformed-newline',
    note: 'malformed open <group:Name\\n (missing >) still opens a group',
    blocks: [text('<group:Reviewing changes\ninside malformed group\n</group>\ntail')],
  },
  {
    id: 'group-malformed-eob',
    note: 'malformed open <group:Name at end of settled block',
    blocks: [text('prose before\n<group:Wrapping up')],
  },
  {
    id: 'group-fused-open-close',
    note: 'fused <group:Name</group:> treated as a single group OPEN',
    blocks: [text('<group:Wrapping up</group:>\nwork inside\n</group>\nafter')],
  },
  {
    id: 'group-close-empty-name',
    note: '</group:> empty-name close variant',
    blocks: [text('<group:Checking>\ninside\n</group:>\nafter close')],
  },
  {
    id: 'prose-angle-brackets',
    note: 'a < b comparisons and <NotATag> stay literal text',
    blocks: [text('When a < b holds and x <group is not a tag, <NotATag> stays literal.')],
  },
  {
    id: 'prompts-basic',
    note: 'suggested prompts block stripped, prompts surfaced',
    blocks: [text('Work is done.\n\n<!-- suggested-prompts\nRun the tests.\nOpen a PR.\n-->\n')],
  },
  {
    id: 'prompts-label-and-delay',
    note: 'label|prompt and delay:N| prompt syntaxes',
    blocks: [
      text(
        'Deployed.\n\n<!-- suggested-prompts\nCheck|Check the deployment status.\ndelay:60|Re-check CI in a minute.\nLabel|delay:30|Combined label and delay.\n-->\n',
      ),
    ],
  },
  {
    id: 'prompts-only-trailing-block',
    note: 'trailing text block containing only a prompts comment is dropped from render',
    blocks: [
      text('<group:Finishing>\nfinal work\n</group>\n'),
      text('<!-- suggested-prompts\nArchive the workspace.\n-->\n'),
    ],
  },
  {
    id: 'special-augment-snippet',
    note: 'augment_code_snippet XML block with 4-backtick fence',
    blocks: [
      text(
        'Here is the relevant code:\n\n<augment_code_snippet path="src/lib/utils/foo.ts" mode="EXCERPT">\n````typescript\nexport function foo(): number {\n  return 42;\n}\n````\n</augment_code_snippet>\n\nThat is the function.',
      ),
    ],
  },
  {
    id: 'special-mermaid-cli-navlink',
    note: 'mermaid + ws-block:cli + nav-link fenced blocks',
    blocks: [
      text(
        'Flow:\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nRun this:\n\n```ws-block:cli\n{"command": "pnpm run check", "description": "typecheck"}\n```\n\nOpen settings:\n\n```nav-link\n{"target": "/settings", "label": "Settings"}\n```\n',
      ),
    ],
  },
  {
    id: 'special-reference-tilde',
    note: 'ws-block:reference with tilde fence',
    blocks: [
      text(
        'See:\n\n~~~ws-block:reference\n{"semanticId": "src/lib/utils/messageParser.ts#symbol:groupContentBlocks"}\n~~~\n',
      ),
    ],
  },
  {
    id: 'special-code-fences',
    note: 'plain code fence and diff fence',
    blocks: [
      text(
        'Change:\n\n```diff\n- const a = 1;\n+ const a = 2;\n```\n\nUsage:\n\n```typescript\nconst a = 2;\n```\n',
      ),
    ],
  },

  // -------------------------------------------------------------------------
  // KNOWN-BAD: tag literals inside code regions (intent-hq/monorepo#2689)
  // -------------------------------------------------------------------------
  {
    id: 'bad-group-literal-inline-code',
    note: 'group tag inside inline code should stay literal',
    blocks: [
      text(
        'The parser mishandles the `<group:Example>` tag when it appears in backticks like this.',
      ),
    ],
  },
  {
    id: 'bad-group-empty-literal-inline-code',
    note: 'empty-name group literal in inline code (repro shape from #2689)',
    blocks: [
      text(
        'copies leaked suggested-prompts content and `<group:>` tags. The fix mirrors the display pipeline.\n\nNow waiting on the CI re-run.',
      ),
    ],
  },
  {
    id: 'bad-group-close-literal-inline-code',
    note: 'group close tag inside inline code',
    blocks: [text('A stray close such as `</group>` in prose gets consumed by the scanner.')],
  },
  {
    id: 'bad-think-literal-inline-code',
    note: 'think tag inside inline code',
    blocks: [text('The scanner also matches `<think>` in backticks, hiding everything after it.')],
  },
  {
    id: 'bad-group-literal-fenced-code',
    note: 'tags inside a ``` fence should stay literal',
    blocks: [
      text(
        'The stream looks like:\n\n```\n<group:Working>\ndoing things\n</group>\n```\n\nThat fence should render verbatim.',
      ),
    ],
  },
  {
    id: 'bad-regex-source-fenced-code',
    note: 'GROUP_AND_THINK_TAG_REGEX source quoted in an augment-style fence',
    blocks: [
      text(
        'The scanner regex is:\n\n````typescript path=src/lib/utils/messageParser.ts mode=EXCERPT\nconst GROUP_AND_THINK_TAG_REGEX =\n  /<group:([^>\\n<]+)>|<group:([^\\n<]+)\\n|<group:([^>\\n<]+)$|.../g;\n````\n\nBecause the second alternative accepts anything up to a newline, it misfires.',
      ),
    ],
  },
  {
    id: 'bad-prompts-literal-fenced-code',
    note: 'suggested-prompts syntax quoted in a fence stays literal (parseSuggestedPrompts is fence-aware)',
    blocks: [
      text(
        'The syntax is:\n\n```\n<!-- suggested-prompts\nExample prompt.\n-->\n```\n\nDocumented above, not a real block.',
      ),
    ],
  },
];
