// @vitest-environment node
import path from 'node:path';
import { ESLint, RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { expect, it } from 'vitest';
import rule from './no-copied-chat-panel-selector-mocks.js';

const filename = path.resolve('src/lib/components/chat/__tests__/copied.test.ts');
const panel = "import ChatPanel from '../ChatPanel.svelte';";
const selectors = '$store/renderer/slices/chat-state/chat-state-selectors';
const scaffold = './mocks/chat-panel-render-scaffold';
const incomplete = `vi.mock('${selectors}', () => ({ selectChatError: vi.fn() }));`;
const shared = `(await import('${scaffold}')).chatStateSelectors()`;
const error = { messageId: 'sharedDefaults' };
const tester = new RuleTester({ languageOptions: { parser } });

tester.run('no-copied-chat-panel-selector-mocks', rule, {
  valid: [
    {
      filename,
      code: `import type ChatPanel from '../ChatPanel.svelte'; ${incomplete}`,
    },
    {
      filename,
      code: `${panel} import { chatStateSelectors as defaults } from '${scaffold}';
        vi.mock('${selectors}', () => ({ ...defaults(), selectChatError: liveSelector }));`,
    },
    {
      filename,
      code: `${panel} import * as mocks from '${scaffold}';
        vi.mock('${selectors}', () => mocks.chatStateSelectors());`,
    },
    { filename, code: incomplete },
    { filename, code: `// import ChatPanel from '../ChatPanel.svelte';\n${incomplete}` },
    { filename, code: `${panel} vi.mock('../ChatPanel.svelte', () => ({})); ${incomplete}` },
    {
      filename,
      code: `${panel} vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({}));`,
    },
    { filename, code: `${panel} vi.mock('${selectors}', async () => ${shared});` },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({ ...${shared}, selectChatError: liveSelector }));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        const { chatStateSelectors: defaults } = await import('${scaffold}');
        return { ...defaults(), selectChatError: liveSelector };
      });`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        const mocks = await import('${scaffold}');
        const defaults = mocks.chatStateSelectors();
        return { ...defaults, selectChatError: liveSelector };
      });`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ({
        ...await importOriginal(), selectChatError: liveSelector,
      }));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({
        ...await vi.importActual('${selectors}'), selectChatError: liveSelector,
      }));`,
    },
    { filename, code: `${panel} vi.doMock(import('${selectors}'), async () => ${shared});` },
  ],
  invalid: [
    {
      filename,
      code: `import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
        vi.mock('../../../../store/renderer/slices/chat-state/chat-state-selectors.ts', () => ({}));`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} import { chatStateSelectors } from '${scaffold}';
        vi.mock('${selectors}', () => {
          const chatStateSelectors = () => ({});
          return chatStateSelectors();
        });`,
      errors: [error],
    },
    { filename, code: `${panel} ${incomplete}`, errors: [error] },
    {
      filename,
      code: `${incomplete} const component = import('../ChatPanel.svelte');`,
      errors: [error],
    },
    { filename, code: `${panel} vi.doMock('${selectors}', () => ({}));`, errors: [error] },
    { filename, code: `${panel} vi.mock(import('${selectors}'), () => ({}));`, errors: [error] },
    { filename, code: `${panel} vi.mock('${selectors}');`, errors: [error] },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        await import('${scaffold}');
        return { selectChatError: vi.fn() };
      });`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({
        ...(await import('${scaffold}')).agentSessionSelectors(),
      }));`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        const defaults = async () => ${shared};
        return {};
      });`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        if (condition) return ${shared};
        return {};
      });`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => {
        let defaults = ${shared};
        defaults = {};
        return defaults;
      });`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({
        ...(await import('./other/chat-panel-render-scaffold')).chatStateSelectors(),
      }));`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({
        ...await vi.importActual('$store/renderer/slices/agent-session/agent-session-selectors'),
      }));`,
      errors: [error],
    },
    ...['agent-session', 'agent-queue', 'unread-tracking', 'transient-ui', 'provider-catalog'].map(
      (slice) => ({
        filename,
        code: `${panel} vi.mock('$store/renderer/slices/${slice}/${slice}-selectors', () => ({}));`,
        errors: [error],
      }),
    ),
  ],
});

it('enables the guard in the repository config and accepts shared overrides', async () => {
  const eslint = new ESLint();
  const lint = async (code) =>
    (await eslint.lintText(code, { filePath: filename }))[0].messages.filter(
      (message) => message.ruleId === 'intent/no-copied-chat-panel-selector-mocks',
    );
  expect(await lint(`${panel} ${incomplete}`)).toHaveLength(1);
  expect(
    await lint(
      `${panel} vi.mock('${selectors}', async () => ({ ...${shared}, selectChatError: liveSelector }));`,
    ),
  ).toEqual([]);
});
