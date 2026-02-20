#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const filePath = path.join(__dirname, '../src/features/agent/main/unified-agent-handlers.ts');

let content = fs.readFileSync(filePath, 'utf-8');

// Fix the pattern where we have:
// CHANNEL_NAME
// )
// );
// Should become:
// CHANNEL_NAME,
// ),
// );

// Pattern 1: Fix channel parameter on its own line followed by )
content = content.replace(
  /(\s+)(AGENT_CHANNELS\.[A-Z_]+)\s*\)\s*\)/gm,
  '$1$2,\n$1),\n  )',
);

// Pattern 2: Fix channel parameter on its own line followed by ) with different indentation
content = content.replace(
  /(\s+)(WORKSPACE_CHANNELS\.[A-Z_]+)\s*\)\s*\)/gm,
  '$1$2,\n$1),\n  )',
);

// Pattern 3: Fix channel parameter on its own line followed by ) with different indentation
content = content.replace(
  /(\s+)(NOTES_CHANNELS\.[A-Z_]+)\s*\)\s*\)/gm,
  '$1$2,\n$1),\n  )',
);

// Pattern 4: Fix any remaining patterns with channels ending in )
content = content.replace(
  /,\s*([A-Z_]+_CHANNELS\.[A-Z_]+)\s*\)\s*\)/gm,
  ',\n      $1,\n    ),\n  )',
);

// Write the fixed content back
fs.writeFileSync(filePath, content);

console.log('✅ Fixed handler formatting in unified-agent-handlers.ts');
