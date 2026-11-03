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
const shared = `(await (await import('${scaffold}')).chatStateSelectors(importOriginal))`;
const error = { messageId: 'sharedDefaults' };
const realError = { messageId: 'realDefaults' };
const handListed = (name) => ({ messageId: 'handListedFactory', data: { name } });
const scaffoldFilename = path.resolve(
  'src/lib/components/chat/__tests__/mocks/chat-panel-render-scaffold.ts',
);
// The scaffold's own helpers, as they resolve the real module.
const scaffoldHelpers = `
  export function stub(values) { return values; }
  export async function withRealSelectors(importOriginal, selectors) {
    return { ...((await importOriginal()) as Record<string, unknown>), ...selectors };
  }
  export async function withReal(importOriginal, values = {}) {
    return withRealSelectors(importOriginal, stub(values));
  }`;
const preferences = '$store/renderer/slices/user-preferences/user-preferences-selectors';
// The cloudlands-fe#3525 shape: every selector ChatPanel read, listed by hand.
const copiedPreferences = `vi.mock('${preferences}', () => ({
  selectChatAuroraEnabled: vi.fn(),
  selectIsAgentMonospace: vi.fn(),
}));`;
const withReal = (overrides = '{ selectChatAuroraEnabled: false }') =>
  `(await import('${scaffold}')).withReal(importOriginal, ${overrides})`;
const tester = new RuleTester({ languageOptions: { parser } });

tester.run('no-copied-chat-panel-selector-mocks', rule, {
  valid: [
    {
      filename,
      code: `${panel} vi.mock('${selectors}', { spy: true });`,
    },
    {
      filename,
      code: `${panel} vi.doMock(import('${selectors}'), { spy: true });`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ({
        ...${shared}, selectChatError: liveSelector,
      } satisfies Record<string, unknown>));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ({
        ...await importOriginal(), selectChatError: liveSelector,
      } satisfies Record<string, unknown>));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => importOriginal());`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => vi.importActual('${selectors}'));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => {
        const actual = importOriginal();
        return { ...await actual, selectChatError: liveSelector };
      });`,
    },
    {
      filename,
      code: `import type ChatPanel from '../ChatPanel.svelte'; ${incomplete}`,
    },
    {
      filename,
      code: `${panel} import { chatStateSelectors as defaults } from '${scaffold}';
        vi.mock('${selectors}', async (importOriginal) => ({
          ...(await defaults(importOriginal)), selectChatError: liveSelector,
        }));`,
    },
    {
      filename,
      code: `${panel} import * as mocks from '${scaffold}';
        vi.mock('${selectors}', (importOriginal) => mocks.chatStateSelectors(importOriginal));`,
    },
    { filename, code: incomplete },
    { filename, code: `// import ChatPanel from '../ChatPanel.svelte';\n${incomplete}` },
    { filename, code: `${panel} vi.mock('../ChatPanel.svelte', () => ({})); ${incomplete}` },
    {
      filename,
      code: `${panel} vi.mock('$lib/client', () => ({}));`,
    },
    {
      filename,
      code: `${panel} vi.mock('$store/renderer/slices/workspace/workspace-slice', () => ({}));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) =>
        (await import('${scaffold}')).withRealSelectors(importOriginal, {
          selectChatAuroraEnabled: liveSelector,
        }),
      );`,
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => ${withReal()});`,
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => ${withReal('')});`,
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => ({
        ...await ${withReal()}, selectChatAuroraEnabled: liveSelector,
      }));`,
    },
    {
      filename,
      code: `${panel} import { withReal } from '${scaffold}';
        vi.mock('${preferences}', (importOriginal) => withReal(importOriginal, {}));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => ({
        ...(await importOriginal()), selectChatAuroraEnabled: liveSelector,
      }));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ${withReal()});`,
    },
    { filename, code: `${panel} vi.mock('../ChatPanel.svelte', () => ({})); ${copiedPreferences}` },
    { filename, code: `${panel} vi.mock('${selectors}', async (importOriginal) => ${shared});` },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ({ ...${shared}, selectChatError: liveSelector }));`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => {
        const { chatStateSelectors: defaults } = await import('${scaffold}');
        return { ...(await defaults(importOriginal)), selectChatError: liveSelector };
      });`,
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => {
        const mocks = await import('${scaffold}');
        const defaults = mocks.chatStateSelectors(importOriginal);
        return { ...(await defaults), selectChatError: liveSelector };
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
    {
      filename,
      code: `${panel} vi.doMock(import('${selectors}'), async (importOriginal) => ${shared});`,
    },
    // The scaffold's selector factories start from the real module.
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export function chatStateSelectors(importOriginal) {
          return withReal(importOriginal, { selectTranscriptHydratedOnce: true });
        }
        export function agentSessionSelectors(importOriginal: () => Promise<unknown>) {
          return withRealSelectors(importOriginal, { selectAgentSession: liveSelector });
        }
        export const transientUiSelectors = (importOriginal) => withReal(importOriginal);
        export async function providerCatalogSelectors(importOriginal) {
          return { ...(await importOriginal()), selectProviderDisplayName: liveSelector };
        }
        export function appClient() { return { appClient: {} }; }`,
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        function chatStateSelectors(importOriginal) {
          return withReal(importOriginal, { selectTranscriptHydratedOnce: true });
        }
        const agentQueueSelectors = (importOriginal) => withReal(importOriginal);
        export { chatStateSelectors, agentQueueSelectors };`,
    },
    // Outside the scaffold, a local *Selectors helper is not a factory.
    { filename, code: `export function chatStateSelectors() { return stub({}); }` },
  ],
  invalid: [
    // The cloudlands-fe#4114 shape: a scaffold factory listed by hand misses the
    // next selector ChatPanel reads and crashes every suite that uses it.
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export function chatStateSelectors() {
          return stub({ selectChatError: null, selectChatIsInterrupting: false });
        }`,
      errors: [handListed('chatStateSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export function agentSessionSelectors() {
          return { ...stub({ selectAgentIsResponding: false }), selectAgentSession: liveSelector };
        }`,
      errors: [handListed('agentSessionSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export const unreadTrackingSelectors = () => ({ selectDividerSession: liveSelector });`,
      errors: [handListed('unreadTrackingSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export function presenceSelectors(importOriginal) {
          return withReal(async () => ({}), {});
        }`,
      errors: [handListed('presenceSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export function chatStateSelectors(importOriginal) {
          if (condition) return stub({});
          return withReal(importOriginal);
        }`,
      errors: [handListed('chatStateSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `export function stub(values) { return values; }
        export async function withRealSelectors(importOriginal, selectors) {
          return { ...selectors };
        }
        export async function withReal(importOriginal, values = {}) {
          return stub(values);
        }`,
      errors: [handListed('withRealSelectors'), handListed('withReal')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        function withRealCopy(importOriginal, values) { return values; }
        export function chatStateSelectors(importOriginal) {
          return withRealCopy(importOriginal, {});
        }`,
      errors: [handListed('chatStateSelectors')],
    },
    // Export lists are held to the same contract as inline exports.
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        function chatStateSelectors() { return stub({ selectChatError: null }); }
        export { chatStateSelectors };`,
      errors: [handListed('chatStateSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        const copied = () => stub({ selectChatError: null });
        export { copied as chatStateSelectors };`,
      errors: [handListed('chatStateSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        let chatStateSelectors = (importOriginal) => withReal(importOriginal);
        chatStateSelectors = () => stub({});
        export { chatStateSelectors };`,
      errors: [handListed('chatStateSelectors')],
    },
    {
      filename: scaffoldFilename,
      code: `${scaffoldHelpers}
        export { chatStateSelectors } from './copied-selectors';`,
      errors: [handListed('chatStateSelectors')],
    },
    // A scaffold factory called without the mock's importOriginal is hand-listed.
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () =>
        (await import('${scaffold}')).chatStateSelectors(),
      );`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) =>
        (await import('${scaffold}')).chatStateSelectors(async () => ({})),
      );`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('../ChatPanel.svelte', { spy: true }); ${incomplete}`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('../ChatPanel.svelte', async (importOriginal) => importOriginal()); ${incomplete}`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.doMock('../ChatPanel.svelte', async () => await vi.importActual('../ChatPanel.svelte')); ${incomplete}`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', { spy: false });`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => ({
        ...importOriginal(), selectChatError: liveSelector,
      }));`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async () => ({
        ...vi.importActual('${selectors}'), selectChatError: liveSelector,
      }));`,
      errors: [error],
    },
    {
      filename,
      code: `${panel} vi.mock('${selectors}', async (importOriginal) => {
        const actual = importOriginal();
        return { ...actual, selectChatError: liveSelector };
      });`,
      errors: [error],
    },
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
    { filename, code: `${panel} ${copiedPreferences}`, errors: [realError] },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async () =>
        (await import('${scaffold}')).stub({ selectChatAuroraEnabled: false }),
      );`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => ({
        ...${withReal()}, selectChatAuroraEnabled: liveSelector,
      }));`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) =>
        (await import('${scaffold}')).withReal(async () => ({}), {}),
      );`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => {
        const importOriginalCopy = async () => ({});
        return (await import('${scaffold}')).withReal(importOriginalCopy, {});
      });`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) =>
        (await import('./other/chat-panel-render-scaffold')).withReal(importOriginal, {}),
      );`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => {
        importOriginal = async () => ({ selectChatAuroraEnabled: vi.fn() });
        return (await import('${scaffold}')).withReal(importOriginal, {});
      });`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) => {
        importOriginal = async () => ({ selectChatAuroraEnabled: vi.fn() });
        return { ...(await importOriginal()) };
      });`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('${preferences}', async (importOriginal) =>
        (await import('${scaffold}')).withRealSelectors(async () => ({}), {}),
      );`,
      errors: [realError],
    },
    {
      filename,
      code: `${panel} vi.mock('$store/renderer/slices/provider-catalog/workspace-catalog-selectors', () => ({}));`,
      errors: [realError],
    },
    ...[
      'git',
      'pending-submissions',
      'proposal-lifecycle',
      'workspace',
      'browser',
      'chat-panel-ui',
      'multi-panel-context',
      'panel-layout',
      'permission',
      'presence',
      'principal',
      'question-ui',
      'specialists',
      'task-agent-associations',
      'terminals',
      'workspace-navigation',
      'workspace-notes',
      'workspace-tasks',
    ].map((slice) => ({
      filename,
      code: `${panel} vi.mock('$store/renderer/slices/${slice}/${slice}-selectors', () => ({}));`,
      errors: [realError],
    })),
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
  expect(await lint(`${panel} ${copiedPreferences}`)).toHaveLength(1);
  expect(
    await lint(`${panel} vi.mock('${preferences}', async (importOriginal) => ${withReal()});`),
  ).toEqual([]);
  expect(
    await lint(
      `${panel} vi.mock('${selectors}', async (importOriginal) => ({ ...${shared}, selectChatError: liveSelector }));`,
    ),
  ).toEqual([]);
});

it('enables the guard on the shared render scaffold', async () => {
  const eslint = new ESLint();
  const lint = async (code) =>
    (await eslint.lintText(code, { filePath: scaffoldFilename }))[0].messages.filter(
      (message) => message.ruleId === 'intent/no-copied-chat-panel-selector-mocks',
    );
  expect(
    await lint(`${scaffoldHelpers}
      export function chatStateSelectors() { return stub({ selectChatError: null }); }`),
  ).toHaveLength(1);
  const [result] = await eslint.lintFiles([scaffoldFilename]);
  expect(
    result.messages.filter(
      (message) => message.ruleId === 'intent/no-copied-chat-panel-selector-mocks',
    ),
  ).toEqual([]);
});
