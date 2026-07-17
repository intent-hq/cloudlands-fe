/**
 * Live AppClient composition.
 *
 * Most domains reach the live intentd daemon via JSON-RPC (`backend:request`/
 * `backend:listen`). Exceptions: `browser` reads/writes `recentUrls` from
 * localStorage (FE-local state per IMPLEMENTATION_SPEC §9 Group C, no daemon
 * persistence); `system` uses JSON-RPC `system.status` and calls `autoUpdateClient`
 * for update state.
 *
 * Live domains: `workspaces` (Wave 6.0); `agents`, `notes`, `tasks`, `comments`,
 * `git`, `files` (Wave 6.1); `terminals`, `settings` (Wave 10); `specialists`
 * (`specialist.list`, PROTOCOL §5.11); `integrations` (`github.*` / `linear.*` /
 * `sentry.*`, PROTOCOL §5.27–5.29); `scripts` (`script.*`, PROTOCOL §5.8);
 * `setupScripts` (`workspace.*SetupScript` / `detectProjectType`, PROTOCOL §5.25);
 * `events` (`event.query`, PROTOCOL §5.10); `models` (`models.list`, PROTOCOL §5.30);
 * `skills` (`skill.list`, PROTOCOL §5.34); `system`, `browser`, `chat` (INT-14).
 */
import type { AppClient } from "../app-client";
import { LiveAgentsClient } from "./live-agents-client";
import { LiveBrowserClient } from "./live-browser-client";
import { LiveChatClient } from "./live-chat-client";
import { LiveCommentsClient } from "./live-comments-client";
import { LiveDraftsClient } from "./live-drafts-client";
import { LiveEventsClient } from "./live-events-client";
import { LiveFilesClient } from "./live-files-client";
import { LiveGitClient } from "./live-git-client";
import { LiveIntegrationsClient } from "./live-integrations-client";
import { LiveModelsClient } from "./live-models-client";
import { LiveNotesClient } from "./live-notes-client";
import { LiveScriptsClient } from "./live-scripts-client";
import { LiveSettingsClient } from "./live-settings-client";
import { LiveSetupScriptsClient } from "./live-setup-scripts-client";
import { LiveSkillsClient } from "./live-skills-client";
import { LiveSpecialistsClient } from "./live-specialists-client";
import { LiveSystemClient } from "./live-system-client";
import { LiveServerClient } from "./live-server-client";
import { LiveTasksClient } from "./live-tasks-client";
import { LiveTerminalsClient } from "./live-terminals-client";
import { LiveWorkspacesClient } from "./live-workspaces-client";

export class LiveAppClient implements AppClient {
  // All domains are now live.
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
  readonly scripts = new LiveScriptsClient();
  readonly setupScripts = new LiveSetupScriptsClient();
  readonly events = new LiveEventsClient();
  readonly models = new LiveModelsClient();

  readonly chat = new LiveChatClient();
  readonly skills = new LiveSkillsClient();
  readonly browser = new LiveBrowserClient();
  readonly system = new LiveSystemClient();
  readonly server = new LiveServerClient();
  readonly drafts = new LiveDraftsClient();
}
