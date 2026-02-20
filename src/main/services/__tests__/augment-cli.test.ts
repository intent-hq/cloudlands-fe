/**
 * Tests for AugmentCLI service
 * Verifies tool call extraction and message parsing
 */

import { AugmentCLI } from '../../../features/auggie/main/augment-cli';

describe('AugmentCLI', () => {
  let augmentCLI: AugmentCLI;

  beforeEach(() => {
    augmentCLI = new AugmentCLI();
  });

  describe('cleanAgentMessage', () => {
    it('should remove tool call markers', () => {
      const input = `🔧 Tool call: view
path: src/main/index.ts

📋 Tool result: view

Here's the result of running \`cat -n\` on src/main/index.ts:
     1	import { app } from 'electron';

🤖

The file shows the main entry point for the Electron app.`;

      const result = augmentCLI['cleanAgentMessage'](input);

      expect(result).not.toContain('🔧 Tool call');
      expect(result).not.toContain('📋 Tool result');
      expect(result).toContain('The file shows the main entry point');
    });

    it('should handle robot emoji delimiter', () => {
      const input = `Tool execution details...
🤖
This is the actual response content.`;

      const result = augmentCLI['cleanAgentMessage'](input);

      expect(result).toContain('This is the actual response content');
      expect(result).not.toContain('Tool execution details');
    });

    it('should remove ANSI codes', () => {
      const input = '\u001b[32mGreen text\u001b[0m normal text';
      const result = augmentCLI['cleanAgentMessage'](input);

      expect(result).toContain('Green text');
      expect(result).not.toContain('\u001b');
    });

    it('should handle empty input', () => {
      const result = augmentCLI['cleanAgentMessage']('');
      expect(result).toBe('');
    });
  });

  describe('removeAnsiCodes', () => {
    it('should remove ANSI escape sequences', () => {
      const input = '\u001b[1;32mBold Green\u001b[0m';
      const result = augmentCLI['removeAnsiCodes'](input);

      expect(result).toBe('Bold Green');
      expect(result).not.toContain('\u001b');
    });

    it('should handle multiple ANSI codes', () => {
      const input = '\u001b[31mRed\u001b[0m \u001b[32mGreen\u001b[0m';
      const result = augmentCLI['removeAnsiCodes'](input);

      expect(result).toBe('Red Green');
    });
  });
});
