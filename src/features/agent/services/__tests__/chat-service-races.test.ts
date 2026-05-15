import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';

describe('retired chat service boundary', () => {
  it('keeps chat service orchestration retired from production code', () => {
    const retiredServicePath = resolve(
      process.cwd(),
      'src/features/agent/services/chat.service.ts',
    );

    expect(existsSync(retiredServicePath)).toBe(false);
  });

  it('keeps one-shot UI cleanup requests out of Redux boundaries', () => {
    const files = [
      'src/lib/store/slices/chat-state/chat-state-types.ts',
      'src/lib/store/slices/chat-state/chat-state-slice.ts',
      'src/lib/store/slices/chat-state/chat-state-selectors.ts',
      'src/lib/store/slices/chat-state/sagas/send-message-saga.ts',
      'src/lib/components/chat/ChatPanel.svelte',
    ];
    const forbidden = [
      ['ui', 'Cleanup', 'Request'].join(''),
      ['chat', 'Ui', 'Cleanup'].join(''),
      ['record', 'Input', 'History'].join(''),
    ];

    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      for (const term of forbidden) {
        expect(source, `${file} must not contain ${term}`).not.toContain(term);
      }
    }
  });
});
