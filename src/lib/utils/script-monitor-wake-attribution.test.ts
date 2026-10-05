import { describe, it, expect } from 'vitest';
import { getScriptMonitorWakeAttribution } from './script-monitor-wake-attribution';
import { getAutomatedWakePresentation } from '$lib/components/chat/automated-wake-presentation';
import type { AgentMessage } from '$shared/types';
const metadata = {
  type: 'script_monitor_wake',
  source: 'system',
  monitorId: 'm',
  workspaceId: 'w',
  scriptId: 's',
  runId: 'r',
  scriptName: 'Tests',
  reason: 'output-match',
  trigger: { observedLineCount: 1, matchedLine: '' },
};
describe('script monitor wake metadata', () => {
  it('preserves an empty matched line and rejects missing identity or non-system attribution', () => {
    expect(getScriptMonitorWakeAttribution(metadata)?.matchedLine).toBe('');
    expect(getScriptMonitorWakeAttribution({ ...metadata, runId: '' })).toBeNull();
    expect(getScriptMonitorWakeAttribution({ ...metadata, source: 'user' })).toBeNull();
    expect(getScriptMonitorWakeAttribution({ ...metadata, reason: 'unknown' })).toBeNull();
  });
  it('recognizes restored block metadata, without text-only attribution spoofing', () => {
    const message: AgentMessage = {
      id: 'wake',
      role: 'user',
      timestamp: new Date(),
      contentBlocks: [{ type: 'text', text: '[Script monitor] output', messageMetadata: metadata }],
    };
    expect(getAutomatedWakePresentation(message)).toMatchObject({
      kind: 'script',
      state: 'delivered',
      attribution: { runId: 'r' },
    });
    expect(
      getAutomatedWakePresentation({
        ...message,
        contentBlocks: [{ type: 'text', text: '[Script monitor] output' }],
      }),
    ).toBeNull();
  });
});
