/**
 * Live AppClient composition.
 *
 * Implements migrated domains against the live intentd daemon (via the JSON-RPC
 * IPC bridge) and delegates every not-yet-migrated domain to an internal
 * `MockAppClient` instance. This is the transition pattern: each later wave moves
 * one more domain from the mock delegate to a live implementation, and once the
 * last domain migrates the `MockAppClient` delegate is removed entirely.
 *
 * Migrated to the live daemon: `workspaces` (Wave 6.0); `agents`, `notes`,
 * `tasks`, `comments`, `git`, `files` (Wave 6.1); `terminals`, `settings`
 * (Wave 10 — interactive PTY + settings foundation); `specialists`
 * (`specialist.list`, PROTOCOL §5.11); `integrations` (`github.*` /
 * `linear.*` / `sentry.*`, PROTOCOL §5.27–5.29).
 */
import type { AppClient } from "../app-client";
import { MockAppClient } from "../mock/mock-app-client";
import { LiveAgentsClient } from "./live-agents-client";
import { LiveCommentsClient } from "./live-comments-client";
import { LiveFilesClient } from "./live-files-client";
import { LiveGitClient } from "./live-git-client";
import { LiveIntegrationsClient } from "./live-integrations-client";
import { LiveNotesClient } from "./live-notes-client";
import { LiveSettingsClient } from "./live-settings-client";
import { LiveSpecialistsClient } from "./live-specialists-client";
import { LiveTasksClient } from "./live-tasks-client";
import { LiveTerminalsClient } from "./live-terminals-client";
import { LiveWorkspacesClient } from "./live-workspaces-client";

export class LiveAppClient implements AppClient {
  /** Delegate for all domains not yet migrated to the live daemon. */
  private readonly mock = new MockAppClient();

  // Migrated to the live daemon.
  readonly workspaces = new LiveWorkspacesClient();
  readonly agents = new LiveAgentsClient();
  readonly notes = new LiveNotesClient();
  readonly tasks = new LiveTasksClient();
  readonly comments = new LiveCommentsClient();
  readonly git = new LiveGitClient();
  readonly files = new LiveFilesClient();
  readonly terminals = new LiveTerminalsClient();
  readonly settings = new LiveSettingsClient();
  readonly specialists = new LiveSpecialistsClient();
  readonly integrations = new LiveIntegrationsClient();

  // Delegated to the mock until their own migration wave.
  readonly chat = this.mock.chat;
  readonly scripts = this.mock.scripts;
  readonly setupScripts = this.mock.setupScripts;
  readonly skills = this.mock.skills;
  readonly models = this.mock.models;
  readonly browser = this.mock.browser;
  readonly system = this.mock.system;
  readonly events = this.mock.events;
}
