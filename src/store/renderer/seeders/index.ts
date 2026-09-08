/**
 * Renderer IPC bridge installer barrel.
 *
 * Importing this module installs the bridge-less renderer handlers required by
 * clients that still invoke Electron-shaped channels in web/mock mode. Domain
 * hydration and business subscriptions are owned by the root sagas.
 */
import './workspaces-seeder';
import './active-streams-bridge-seeder';
import './agent-ipc-bridge-seeder';
import './backend-status-bridge-seeder';
import './connections-bridge-seeder';
import './host-bridge-seeder';
import './git-bridge-seeder';
import './file-bridge-seeder';
import './repo-config-bridge-seeder';
import './provider-status-bridge-seeder';
import './antigravity-setup-bridge-seeder';
import './pi-mcp-bridge-seeder';
import './shell-reveal-bridge-seeder';
import './model-catalog-bridge-seeder';
import './integrations-bridge-seeder';
import './terminals-scripts-seeder';
import './settings-legacy-bridge-seeder';
import './misc-ui-events-seeder';
import './panel-layout-bridge-seeder';
import './auto-update-bridge-seeder';
import './release-notes-bridge-seeder';
import './window-state-bridge-seeder';
import './browser-ipc-bridge-seeder';
import './native-dialog-bridge-seeder';
import './voice-local-bridge-seeder';
import './notification-bridge-seeder';
import './quit-confirmation-bridge-seeder';
import './language-preference-bridge-seeder';
import './renderer-log-bridge-seeder';
import './user-activity-bridge-seeder';
import './workspace-summaries-bridge-seeder';
