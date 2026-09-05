import { describe, expect, it } from 'vitest';
import { resolveChatPanelCompactMode } from '../chat-panel-compact-mode';

const ENTER_HEIGHT = 600;
const EXIT_HEIGHT = 640;

function resolveSequence(initial: boolean, heights: number[]) {
  return heights.reduce(
    (current, height) => resolveChatPanelCompactMode(current, height, ENTER_HEIGHT, EXIT_HEIGHT),
    initial,
  );
}

describe('resolveChatPanelCompactMode', () => {
  it('retains compact mode until the exit threshold is crossed', () => {
    expect(resolveSequence(true, [ENTER_HEIGHT, 626, EXIT_HEIGHT])).toBe(true);
    expect(resolveChatPanelCompactMode(true, EXIT_HEIGHT + 1, ENTER_HEIGHT, EXIT_HEIGHT)).toBe(
      false,
    );
  });

  it('retains normal mode until the enter threshold is crossed', () => {
    expect(resolveSequence(false, [EXIT_HEIGHT, 626, ENTER_HEIGHT])).toBe(false);
    expect(resolveChatPanelCompactMode(false, ENTER_HEIGHT - 1, ENTER_HEIGHT, EXIT_HEIGHT)).toBe(
      true,
    );
  });

  it('settles rapid reversed resize sequences from the latest height', () => {
    expect(resolveSequence(false, [486, 626, 726, 626, 486])).toBe(true);
    expect(resolveSequence(true, [726, 626, 486, 626, 726])).toBe(false);
  });
});
