/**
 * Mock seeder barrel.
 *
 * Importing this module runs every per-domain seeder's `registerMockSeeder()`
 * side effect so the registry is populated before `seedMockStore()` runs. Each
 * wave appends its own seeder import below; never remove existing entries.
 */
import "./workspaces-seeder";
import "./agents-seeder";
import "./notes-seeder";
