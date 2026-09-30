// @verify-changed-triggers: e2e/build-smoke-helpers.ts, e2e/mock-acp-agent.js
import { readFileSync, rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { setMockAgentBehavior } from '../e2e/build-smoke-helpers';

it('passes the separate parent/child fixture through the file actually read by daemon agents', () => {
  const behavior = {
    response: 'PARENT_ONLY',
    delegate: { name: 'Implementor', prompt: 'CHILD_REQUEST: implement' },
    child: { response: 'CHILD_ONLY', files: { 'child-output.txt': 'child result' } },
  };
  const env = setMockAgentBehavior(behavior);
  try {
    expect(JSON.parse(readFileSync(env.MOCK_AGENT_BEHAVIOR_FILE, 'utf8'))).toEqual({
      files: {},
      ...behavior,
    });
    expect(JSON.parse(env.MOCK_AGENT_BEHAVIOR)).toEqual({ files: {}, ...behavior });
  } finally {
    rmSync(env.MOCK_AGENT_BEHAVIOR_FILE);
  }
});
