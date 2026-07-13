import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { fixImports } from '../../scripts/fix-esm-imports';

describe('fix-esm-imports', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rewrites dynamic TypeScript aliases in built main/MCP output', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fix-esm-imports-'));
    tempDirs.push(tempDir);

    const distDir = join(tempDir, 'dist');
    const outputFile = join(distDir, 'features/mcp/main/mcp/ws-workspace-api.js');
    mkdirSync(join(distDir, 'features/mcp/main/mcp'), { recursive: true });
    writeFileSync(
      outputFile,
      [
        "import { gitService } from '$features/git/main/git.service';",
        "const rename = await import('$features/agent/main/agent-rename');",
        'const backend = await import(',
        "  '$features/agent/main/consolidated-backend.service'",
        ');',
        "const logger = await import('$shared/logger');",
        "const validator = await import('$lib/utils/workspace-validation');",
        "import { store } from '$store/renderer/store';",
        "const bridge = await import('$store/renderer/renderer-store-bridge');",
      ].join('\n'),
    );

    await fixImports({ distDir });

    const rewritten = readFileSync(outputFile, 'utf-8');
    expect(rewritten).not.toContain('$features/');
    expect(rewritten).not.toContain('$shared/');
    expect(rewritten).not.toContain('$lib/');
    expect(rewritten).not.toContain('$store/');
    expect(rewritten).toContain("from '../../../git/main/git.service.js'");
    expect(rewritten).toContain("import('../../../agent/main/agent-rename.js')");
    expect(rewritten).toContain("import('../../../agent/main/consolidated-backend.service.js')");
    expect(rewritten).toContain("import('../../../../shared/logger.js')");
    expect(rewritten).toContain("import('../../../../lib/utils/workspace-validation.js')");
    expect(rewritten).toContain("from '../../../../store/renderer/store.js'");
    expect(rewritten).toContain("import('../../../../store/renderer/renderer-store-bridge.js')");
  });
});
