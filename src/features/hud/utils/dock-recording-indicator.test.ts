import { describe, it, expect } from 'vitest';
import { ownedDockRecording } from './dock-recording-indicator';
const input = {
  workspaceId: 'ws',
  agentId: 'agent',
  authority: 'principal',
  nativePairId: '["ws","agent"]',
  evidence: {
    id: '["ws","agent"]',
    clips: [
      {
        id: 'clip',
        status: 'recording' as const,
        startedAt: 1000,
        durationMs: 0,
        hasMicAudio: false,
        pausedAt: null,
        pausedMs: 0,
      },
    ],
  },
};
describe('owned compact recording status', () => {
  it('projects only the live clip and native timing for the selected owner', () => {
    expect(ownedDockRecording(input, 'principal')).toEqual({
      workspaceId: 'ws',
      agentId: 'agent',
      clipId: 'clip',
      startedAt: 1000,
      pausedAt: null,
      pausedMs: 0,
    });
  });
  it('rejects retired, unselected, foreign native and foreign authority state', () => {
    for (const patch of [
      { workspaceId: null },
      { agentId: null },
      { authority: null },
      { authority: 'old' },
      { nativePairId: null },
      { nativePairId: '["other","agent"]' },
      { evidence: { ...input.evidence, id: '["other","agent"]' } },
    ])
      expect(ownedDockRecording({ ...input, ...patch }, 'principal')).toBeNull();
    expect(ownedDockRecording(input, null)).toBeNull();
  });
  it('never turns completed or placing evidence into a live recording', () => {
    for (const status of ['ready', 'placing', 'failed'] as const)
      expect(
        ownedDockRecording(
          {
            ...input,
            evidence: { ...input.evidence, clips: [{ ...input.evidence.clips[0], status }] },
          },
          'principal',
        ),
      ).toBeNull();
  });
  it('preserves pause timing without starting a second clock or recorder', () => {
    expect(
      ownedDockRecording(
        {
          ...input,
          evidence: {
            ...input.evidence,
            clips: [{ ...input.evidence.clips[0], pausedAt: 2000, pausedMs: 400 }],
          },
        },
        'principal',
      ),
    ).toMatchObject({ startedAt: 1000, pausedAt: 2000, pausedMs: 400 });
  });
  it('rejects invalid live timestamps instead of showing a fabricated elapsed time', () => {
    expect(
      ownedDockRecording(
        {
          ...input,
          evidence: { ...input.evidence, clips: [{ ...input.evidence.clips[0], startedAt: NaN }] },
        },
        'principal',
      ),
    ).toBeNull();
  });
});

import { recordingToggleIntent } from './dock-recording-indicator';
describe('clip-bound compact Stop contract', () => {
  it('ignores a late Stop after completion instead of starting a new recording', () => {
    expect(recordingToggleIntent(undefined, 'old-clip')).toBe('ignore');
  });
  it('does not stop a newer clip when an old Stop arrives', () => {
    expect(recordingToggleIntent('new-clip', 'old-clip')).toBe('ignore');
  });
  it('stops the expected live clip while preserving the ordinary toggle contract', () => {
    expect(recordingToggleIntent('old-clip', 'old-clip')).toBe('stop');
    expect(recordingToggleIntent(undefined)).toBe('start');
    expect(recordingToggleIntent('old-clip')).toBe('stop');
  });
});
