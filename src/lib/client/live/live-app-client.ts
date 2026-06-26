/**
 * Live AppClient composition.
 *
 * Implements migrated domains against the live intentd daemon (via the JSON-RPC
 * IPC bridge) and delegates every not-yet-migrated domain to an internal
 * `MockAppClient` instance. This is the transition pattern: each later wave moves
 * one more domain from the mock delegate to a live implementation, and once the
 * last domain migrates the `MockAppClient` delegate is removed entirely.
 *
 * Migrated in this wave: `workspaces`.
 */
import type { AppClient } from "../app-client";
import { MockAppClient } from "../mock/mock-app-client";
import { LiveWorkspacesClient } from "./live-workspaces-client";

export class LiveAppClient implements AppClient {
  /** Delegate for all domains not yet migrated to the live daemon. */
  private readonly mock = new MockAppClient();

  // Migrated to the live daemon.
  readonly workspaces = new LiveWorkspacesClient();

  // Delegated to the mock until their own migration wave.
  readonly agents = this.mock.agents;
  readonly chat = this.mock.chat;
  readonly terminals = this.mock.terminals;
  readonly settings = this.mock.settings;
  readonly files = this.mock.files;
  readonly git = this.mock.git;
  readonly notes = this.mock.notes;
  readonly tasks = this.mock.tasks;
  readonly comments = this.mock.comments;
  readonly scripts = this.mock.scripts;
  readonly setupScripts = this.mock.setupScripts;
  readonly skills = this.mock.skills;
  readonly specialists = this.mock.specialists;
  readonly models = this.mock.models;
  readonly browser = this.mock.browser;
  readonly integrations = this.mock.integrations;
  readonly system = this.mock.system;
  readonly events = this.mock.events;
}
