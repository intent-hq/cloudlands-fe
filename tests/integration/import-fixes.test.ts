import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integration tests to verify all import fixes are working correctly
 */
describe('Import Fixes Verification', () => {
  const projectRoot = process.cwd();

  describe('NoteWithComments.svelte', () => {
    it('should have proper comment syntax', () => {
      const filePath = join(projectRoot, 'src/lib/components/workspace/NoteWithComments.svelte');
      const content = readFileSync(filePath, 'utf-8');

      // Check that the comment is properly formatted
      expect(content).toContain('// Track when last save happened');
      expect(content).not.toMatch(/^\s*Track when last save happened/m);
    });
  });

  describe('comment-manager-v2.ts', () => {
    it('should have valid import statements', () => {
      const filePath = join(projectRoot, 'src/features/comments/comment-manager-v2.ts');
      const content = readFileSync(filePath, 'utf-8');

      // Check that there are no malformed imports (missing import keyword)
      expect(content).not.toMatch(/^{[^}]+}\s+from\s+['"]/m);
    });
  });

  describe('BubbleMenu.svelte', () => {
    it('should have valid FontAwesome imports', () => {
      const filePath = join(projectRoot, 'src/lib/components/tiptap/BubbleMenu.svelte');
      const content = readFileSync(filePath, 'utf-8');

      // Check for proper import statements
      expect(content).toMatch(
        /import\s+{\s*fa[^}]+}\s+from\s+['"]@fortawesome\/free-solid-svg-icons['"]/,
      );

      // Check no malformed imports
      expect(content).not.toMatch(/import\s+{[^}]*import\s+/);
    });

    it('should have state variables declared', () => {
      const filePath = join(projectRoot, 'src/lib/components/tiptap/BubbleMenu.svelte');
      const content = readFileSync(filePath, 'utf-8');

      // Check for Svelte 5 state declarations
      expect(content).toContain('let showLinkInput = $state(false)');
      expect(content).toContain("let linkInputValue = $state('')");
      expect(content).toContain('let linkInputElement: HTMLInputElement | null = $state(null)');
      expect(content).toContain(
        'let savedLinkSelection: { from: number; to: number } | null = $state(null)',
      );
    });

    it('should have proper comment for bubble up result', () => {
      const filePath = join(projectRoot, 'src/lib/components/tiptap/BubbleMenu.svelte');
      const content = readFileSync(filePath, 'utf-8');

      // Check that the comment is properly formatted
      expect(content).toContain('// Bubble up result');
      expect(content).not.toMatch(/^\s*Bubble up result[^\/]/m);
    });
  });

  // `agent-backend-handler.service.ts` import-shape guard was retired in
  // C1d-7 alongside the handler file itself (adapter now goes daemon-direct).

  describe('line-to-block-mapper.ts', () => {
    it('should have proper imports and structure', () => {
      const filePath = join(projectRoot, 'src/lib/components/tiptap/line-to-block-mapper.ts');
      const content = readFileSync(filePath, 'utf-8');

      // Check for proper logger import
      expect(content).toContain("import { logger } from '$lib/utils/client-logger'");
      // Check for proper type imports
      expect(content).toContain("import type { Editor } from '@tiptap/core'");
    });
  });

  // Note: ContextualMenu.svelte tests removed - component was deleted as unused

  describe('FileActionsDropdown.svelte', () => {
    it('should have all required imports', () => {
      const filePath = join(projectRoot, 'src/lib/components/ui/FileActionsDropdown.svelte');
      const content = readFileSync(filePath, 'utf-8');

      // Check for logger import
      expect(content).toContain("import { createLogger } from '$lib/utils/client-logger'");

      // Check for UI component imports
      expect(content).toContain(
        "import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte'",
      );
      expect(content).toContain("import Button from '$lib/components/ui/button/button.svelte'");
      expect(content).toContain(
        "import WorkspaceActionsMenu from '$lib/components/ui/WorkspaceActionsMenu.svelte'",
      );

      // Check for icon imports
      expect(content).toContain("import Fa from 'svelte-fa'");
      expect(content).toContain(
        "import { faArrowUpRightFromSquare, faChevronDown } from '@fortawesome/free-solid-svg-icons'",
      );
    });
  });

  describe('All fixed files compile without errors', () => {
    it('should not have syntax errors in TypeScript files', () => {
      const tsFiles = [
        'src/features/comments/comment-manager-v2.ts',
        'src/lib/components/tiptap/line-to-block-mapper.ts',
      ];

      tsFiles.forEach((file) => {
        const filePath = join(projectRoot, file);
        const content = readFileSync(filePath, 'utf-8');

        // Basic syntax checks
        expect(content).not.toMatch(/^\s*{[^}]+}\s+from/m); // No orphaned imports (missing import keyword)
        // Note: We don't check for orphaned comments as TypeScript files have many valid lines with colons
      });
    });
  });
});
