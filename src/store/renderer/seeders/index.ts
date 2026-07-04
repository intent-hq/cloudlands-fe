/**
 * Mock seeder barrel.
 *
 * Importing this module runs every per-domain seeder's `registerMockSeeder()`
 * side effect so the registry is populated before `seedMockStore()` runs. Each
 * wave appends its own seeder import below; never remove existing entries.
 */
import "./workspaces-seeder";
import "./agents-seeder";
import "./agent-ipc-bridge-seeder";
import "./host-bridge-seeder";
import "./provider-status-bridge-seeder";
import "./model-catalog-bridge-seeder";
import "./integrations-bridge-seeder";
import "./notes-seeder";
import "./files-git-seeder";
import "./terminals-scripts-seeder";
import "./settings-integrations-seeder";
import "./misc-ui-events-seeder";
