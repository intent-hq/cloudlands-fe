/**
 * Mock seeder barrel.
 *
 * Importing this module runs every per-domain seeder's `registerMockSeeder()`
 * side effect so the registry is populated before `seedMockStore()` runs. Each
 * wave appends its own seeder import below; never remove existing entries.
 */
import './provider-catalog-seeder';
import './workspaces-seeder';
import './active-streams-bridge-seeder';
import './agents-seeder';
import './agent-ipc-bridge-seeder';
import './backend-status-bridge-seeder';
import './connections-bridge-seeder';
import './host-bridge-seeder';
import './git-bridge-seeder';
import './file-bridge-seeder';
import './repo-config-bridge-seeder';
import './provider-status-bridge-seeder';
import './pi-mcp-bridge-seeder';
import './shell-reveal-bridge-seeder';
import './model-catalog-bridge-seeder';
import './integrations-bridge-seeder';
import './notes-seeder';
import './files-git-seeder';
import './terminals-scripts-seeder';
import './settings-integrations-seeder';
import './settings-legacy-bridge-seeder';
import './misc-ui-events-seeder';
import './panel-layout-bridge-seeder';
import './auto-update-bridge-seeder';
import './window-state-bridge-seeder';
import './native-dialog-bridge-seeder';
import './voice-local-bridge-seeder';
import './notification-bridge-seeder';
import './language-preference-bridge-seeder';
