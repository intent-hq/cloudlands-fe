import { runInNewContext } from 'node:vm';

import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

import { BaseMCPTool, createInputSchema, stringProperty } from './tool';
import type { ToolCall, ToolResult } from './protocol';
import { AVAILABLE_TOPICS } from './reference-docs';
import { buildAgentApi } from './ws-agent-api';
import { buildAppUiApi } from './ws-app-ui-api';
import { buildWsEventApi } from './ws-event-api';
import {
  buildBrowserApi,
  buildCrossWorkspaceApi,
  buildFileApi,
  buildTerminalApi,
} from './ws-misc-api';
import { buildNoteApi } from './ws-note-api';
import { buildScriptApi } from './ws-script-api';
import { buildWorkspaceApi } from './ws-workspace-api';
import { buildWsAppAgentsApi } from './ws-app-agents-api';
import { buildWsAppSpecialistsApi } from './ws-app-specialists-api';
import { buildWsAppSettingsApi } from './ws-app-settings-api';
import { buildWsAppProposalApi, buildWsAppWorkspacesApi } from './ws-app-workspaces-api';

const TIMEOUT_MS = 30_000;

const TOOL_DESCRIPTION = [
  'Execute JavaScript against the workspace API. Your code runs as an async function — use `return` to send results back.',
  '',
  'Rules:',
  '  - Your code is wrapped in `(async () => { ... })()` before execution.',
  '  - Use `await` for async calls. Use `return` to send the final value back.',
  '  - Use `Promise.all([...])` for independent reads/writes in one tool call.',
  '  - Use `Promise.allSettled([...])` when you need partial results even if some calls fail.',
  '  - Errors from invalid method names or bad arguments are returned directly.',
  '  - Do not add code comments — the code is executed and discarded, never read by humans.',
  '',
  'Parameters:',
  '  code (required): JavaScript code to execute.',
  '  summary (required): Short description of what this call does, shown in the UI.',
  '',
  'API:',
  '  ws.workspace.info() → { id, path }  // Current workspace ID + absolute path.',
  '  ws.workspace.details() → { id, title, hasTitle, status, statusMessage, branch, repositoryName, tags }  // Workspace metadata; `status` is the lifecycle enum and `statusMessage` is the user-facing work summary.',
  '  ws.workspace.setTitle(title) → { ok, title, branch, skipped? }  // Set a short 1-5 word workspace title. May rename the branch if it is still auto-generated; returns `skipped` if the workspace already has a custom title.',
  '  ws.workspace.setStatusMessage(message) → { ok, statusMessage }  // Set or clear the 1-2 sentence user-facing workspace status message; does not change lifecycle `status` or task statuses. Pass an empty string or null to clear.',
  '  ws.workspace.setAgentName(name) → { ok, name }  // Rename the current agent session. Call this early in your first response and use a short 1-5 word task-focused name.',
  '  ws.workspace.context() → { mainContentType, mainContentId, mainContentPath, diffInfo? }  // Current UI focus (file, note, diff, empty, etc.); use this to understand what the user is looking at before acting.',
  '  ws.workspace.timeline(limit?, type?) → [{ timestamp, type, description }]  // Recent workspace timeline entries; default limit is 50.',
  `  ws.workspace.referenceDocs(topic) → string  // On-demand reference docs for long topics such as ${AVAILABLE_TOPICS.join(', ')}. Use this instead of guessing special block syntax.`,
  '  ws.workspace.emitNotification(topic, message, metadata?) → { ok, eventId }  // Emit a workspace-scoped notification event; useful for service/external-style notifications to subscribed agents.',
  '',
  '  ws.app.agents.list({ workspaceId?, includeCompleted?, limit?, cursor? }?) → { threads, total, returned, nextCursor? }  // Chief workspace only. Lists readable agent threads across app workspaces; metadata only, no transcript content. Defaults to 50 threads, max 200.',
  '  ws.app.agents.readConversation(workspaceId, agentId, { lastN?, startTurn?, endTurn?, includeToolCalls? }?) → { workspaceId, workspaceTitle, agentId, agentName, totalMessages, returnedMessages, startTurn, endTurn, includeToolCalls, taskNoteId?, messages }  // Chief workspace only. Reads a bounded cross-workspace agent conversation. Defaults to last 20 messages, max 100, and excludes tool-call blocks unless `includeToolCalls=true`.',
  '    Safe usage: list first, then read only the relevant thread slices with `lastN` or `startTurn`/`endTurn`; keep `includeToolCalls` false unless the user explicitly needs raw tool-call details.',
  '  ws.app.proposal.show(proposal) → ProposalCard  // Chief workspace only. Render an app-level proposal card in chat.',
  '  ws.app.settings.list({ includeValues?, category? }?) → settings[]  // List schema-backed persisted user settings, optionally with current values.',
  '  ws.app.settings.get(path) → setting  // Read a persisted user setting by schema path; sensitive values are redacted.',
  '  ws.app.settings.propose(changes[] | { changes }) → ProposalCard  // Preview settings changes with a diff; never auto-applies.',
  '  ws.app.specialists.list() → specialists[]  // List app-level specialists with id, name, description, model, prompt, and source metadata.',
  '  ws.app.specialists.get(id) → specialist  // Get one app-level specialist by ID; throws a clear not-found error when missing.',
  '  ws.app.specialists.propose({ action: "create"|"edit"|"delete", id?, name?, description?, model?, prompt?, scope? }) → ProposalCard  // Render a specialist-edit proposal with editable name/description/model/prompt fields.',
  '  ws.app.ui.navigate(route, { highlightId?, durationMs? }?) → { ok, route, highlightId?, durationMs? }  // Navigate the app UI via the renderer router. If highlightId is omitted, the URL hash is used when present.',
  '  ws.app.ui.highlight(id, { durationMs? }?) → { ok, id, durationMs? }  // Pulse a registered highlight target using the UI highlight system.',
  '  ws.app.ui.targets() → [{ id, label, route, highlightId?, category, description, dynamic?, idPattern? }]  // Discover typed app UI targets and highlight ID patterns.',
  '  ws.app.workspaces.archive(id) → ProposalCard  // Chief workspace only. Proposes archive of a single workspace via ws.app.proposal.show; the user confirms before applying.',
  '  ws.app.workspaces.bulkArchive(ids) → ProposalCard  // Chief workspace only. Proposes bulk archive via ws.app.proposal.show.',
  '  ws.app.workspaces.bulkDelete(ids) → ProposalCard  // Chief workspace only. Proposes bulk delete via ws.app.proposal.show.',
  '  ws.app.workspaces.create(params) → ProposalCard  // Chief workspace only. Proposes workspace creation via ws.app.proposal.show; does not create directly.',
  '  ws.app.workspaces.delete(id) → ProposalCard  // Chief workspace only. Proposes delete of a single workspace via ws.app.proposal.show; the user confirms before applying.',
  '  ws.app.workspaces.get(id) → workspace  // Chief workspace only. Get one workspace metadata summary.',
  '  ws.app.workspaces.list({ filter?, sort? }) → workspaces[]  // Chief workspace only. Cross-workspace metadata list with query/status/repository/tags filtering.',
  '  ws.app.workspaces.open(id, { openInNewWindow? }?) → { ok, queued }  // Chief workspace only. Opens a workspace through workspace-operations-saga. Pass `{ openInNewWindow: true }` to open in a new window.',
  '',
  '  ws.note.read(id) → { id, title, content, tags, ... }  // Read a note. Use id=`spec` for the workspace spec. Content has line numbers like `   1 | text`.',
  '  ws.note.create(title, content, tags?) → { id, title, tags, link, markdownLink }  // Create a new note and return canonical `intent://local/{workspaceId}/note/{noteId}` links. Share `markdownLink` with users so they can open the note. DO NOT use this for the spec: the spec already exists as note ID `spec`; edit or add to it instead.',
  '  ws.note.list(tag?) → [{ id, title, tags, ... }]  // List notes. Optional tag filter narrows results.',
  '  ws.note.listTasks(id) → [{ text, status, taskNoteId, linkedTaskNoteId, lineNumber, ... }]  // Faster than `read()` when you only need checkbox/task IDs. Use `taskNoteId` for delegation; `linkedTaskNoteId` is a backward-compatible alias.',
  '  ws.note.readAsset(asset) → { assetId, mimeType, data, sizeKb }  // `asset` can be an asset ID or `workspace-asset://...` URL. Image assets (PNG, JPEG, GIF, WebP) are returned as native image content blocks (the model sees the image directly); non-image assets return the JSON object.',
  '  ws.note.setContent(id, content, confirmReplacement?) → { ... }  // ⚠️ FULL REPLACEMENT: replaces the entire note. Prefer `add()` / `edit()` / `editLines()` unless you intentionally want to overwrite everything.',
  '    If the new content is much shorter, call again with `confirmReplacement=true`. ```task blocks auto-convert into linked task notes.```',
  '  ws.note.add(id, { content, heading?, position? }) → { ... }  // Safest way to add information without losing existing content. Prefer this when asked to "add", "put", "document", or "include" something.',
  '    `position` can be `"end"` (default), `"start"`, or `"after:## Heading"` such as `"after:## Phase 1"`.',
  '  ws.note.edit(id, { old, new }) → { ... }  // Surgical text replacement. `old` must match EXACTLY, including whitespace and line breaks; only the first occurrence is replaced.',
  '  ws.note.editLines(id, { start, end, content }) → { ... }  // Line-based replace/delete/insert. `start` and `end` are 1-based and INCLUSIVE. To delete lines, pass `content: ""`. To insert after a line, set `start` and `end` to the same line and include both the original line and new lines in `content`.',
  '  ws.note.updateMetadata(id, { title?, tags? }) → { ... }  // Safest way to change only title/tags; content is untouched. The spec note title is always `Spec` and cannot be changed.',
  '  ws.note.delete(id) → { ok, noteId, deleted }  // Permanently removes a note.',
  '',
  '  ws.comment.add(noteId, { searchContext, commentTarget, comment, type?, author? }) → { ... }  // Anchor a comment by text search. Use enough `searchContext` to be unique; `commentTarget` must be a substring inside it.',
  '    Search is case- and whitespace-sensitive. You can use the same text for both fields to comment on an entire phrase, and anchor errors explain how to fix mismatches.',
  '  ws.comment.list(noteId, { since?, authorType?, status?, includeComments? }) → [threads]  // Thread summaries grouped by latest activity. Great for agents finding open threads where the user commented last.',
  '    Example filter combo: `{ since: "<timestamp>", authorType: "user", status: "open", includeComments: true }`.',
  '  ws.comment.getThread(noteId, { threadId?, commentId? }) → thread  // Fetch one full thread with replies in order.',
  '  ws.comment.respond(noteId, { threadId?, commentId?, comment, type?, author?, suggestionOriginal?, suggestionProposed? }) → { ... }  // Recommended way to reply: it reuses the parent anchor automatically, so you do not need to search for text again.',
  '    `type` can be `"comment"`, `"suggestion"`, `"question"`, or `"change-request"`. For suggestions, pass both `suggestionOriginal` and `suggestionProposed`.',
  '  ws.comment.delete(noteId, commentId) → { ... }  // Deletes a single comment by ID.',
  '',
  '  ws.task.updateStatus(noteId, taskText, status) → { ok, noteId, status, note }  // Atomically change one checkbox status by task text. Prefer this over `note.setContent()` when marking tasks done/in progress to avoid conflicts.',
  '    `status`: `"done"`, `"todo"`, or `"in-progress"`. `taskText` must match the checkbox text exactly.',
  '  ws.task.updateNoteStatus(noteId, status) → { ok, noteId, status }  // Task-note metadata status. Values include `"not_started"`, `"waiting"`, `"discussion_needed"`, `"in_progress"`, `"review_required"`, `"complete"`, `"cancelled"`.',
  '  ws.task.update(noteId, line, { text?, status?, expected? }) → { ok, lineNumber, ... }  // Atomically edit only one checkbox line, preserving the rest of the note. Prefer this over `note.setContent()` for task edits.',
  '    `line` is the 1-based task line number from `note.read()`. `status`: `"done"`, `"todo"`, or `"in-progress"`. `expected` enables conflict detection if another agent may have changed the task.',
  '  ws.task.getMyTask(taskNoteId) → task  // Reads a task note with metadata, dependencies, and acceptance criteria.',
  '  ws.task.markAsTask(noteId, status, { acceptanceCriteria?, effort? }) → { ... }  // Convert a note into a task note. `acceptanceCriteria` may be an array or JSON string; `effort` maps to estimated effort.',
  '  ws.task.convertBlocks(noteId) → { convertedCount, createdNoteIds }  // Convert ```task blocks into linked task notes. Note updates already auto-convert them; use this for manual re-conversion.',
  '  ws.task.createPrerequisite(dependentNoteId, title, { content?, status? }) → { ... }  // Adds a prerequisite task dependency.',
  '  ws.task.assignAgent(noteId, agentId) → { ok, noteId, agentId }  // Assign an existing agent to a task note. `agentId` must be `agent-{uuid}`; to create and assign in one step, use `ws.agent.create(..., { taskNoteId: noteId })`.',
  '',
  '  ws.primitive.addReference(noteId, semanticId, description, snapshot?) → { ok, primitiveId, noteId }  // Code reference primitive; `semanticId` examples: `src/file.ts#symbol:Foo` or `src/file.ts#L10-20`.',
  '  ws.primitive.addCli(noteId, command, description, workingDirectory?) → { ok, primitiveId, noteId }  // CLI primitive; optional cwd is relative to workspace root.',
  '  ws.primitive.addPatch(noteId, filePath, diff, description) → { ok, primitiveId, noteId }  // Stores an applyable patch block in a note.',
  '  ws.primitive.addAgentAction(noteId, agentId, goal, description) → { ok, primitiveId, noteId }  // Adds a triggerable agent action block.',
  '',
  '  ws.agent.create(name, message, opts?) → { ok, id?, text?, ... }  // Create and start an agent immediately. You are auto-subscribed to its completion events and will be woken when it finishes.',
  '    Specialists include `"implementor"` for implementation work and `"verifier"` for review/verification. `createLinkedNote=true` with `noteContent` creates a linked note; agents are background by default unless `isBackground=false`.',
  '    You can override specialist defaults with `model` or `behaviorPrompt`.',
  '  ws.agent.delegate({ taskNoteId?, noteId?, taskText?, agentInstructions?, specialist?, model?, behaviorPrompt?, waitMode?, skipAutoCommit? }) → { ok, text?, ... }  // Delegate an existing task to a new agent. Prefer `taskNoteId` from `intent://local/task/{id}`; otherwise pass `noteId` + exact `taskText` from a checkbox.',
  '    Delegation starts immediately and auto-subscribes you to completion events. `waitMode`: `"immediate"` wakes after each agent, `"after_all"` wakes after the whole group. Example: `taskNoteId: "abc-123"`.',
  '  ws.agent.send(agentId, message, priority?) → { ok, agentId, ... }  // Send a message to another agent. `priority="interrupt"` stops the target mid-response and delivers the message immediately.',
  '  ws.agent.sendToTask(taskNoteId, message, priority?) → { ok, taskNoteId, ... }  // Follow up with the agent assigned to a task note; more convenient than `send()` when you only know the task note ID. `priority="interrupt"` also stops mid-response.',
  '  ws.agent.subscribe(eventTypes, { excludeSelf?, batchWindow? }) → { subscriptionId, ... }  // Compatibility alias for `ws.event.subscribe()`. `eventTypes` must be an array.',
  '  ws.agent.unsubscribe(subscriptionId) → { ok, subscriptionId }  // Compatibility alias for `ws.event.unsubscribe()`.',
  '  ws.agent.list(includeCompleted?) → [agents]  // Lists agents in this workspace; completed agents are omitted unless requested.',
  '  ws.agent.status(agentId) → agent  // Detailed agent status including task linkage and activity timestamps.',
  '  ws.agent.diagnostics({ agentId?, taskNoteId?, includeCompleted?, staleRespondingAfterMs? }?) → { diagnostics, text }  // Sanitized snapshot of agent statuses, subscriptions, queues, delegation groups, delivery stats, recent delivery events, and stuck-risk signals.',
  '  ws.agent.wakeOrCreate(taskNoteId, contextMessage, model?) → { ... }  // Ensure a task has a working agent: checks assigned agents, resumes a running/restorable one if possible, otherwise creates a new agent for the task.',
  '  ws.agent.readConversation(agentId, { lastN?, startTurn?, endTurn?, includeToolCalls? }) → messages  // Read another agent’s conversation history.',
  '  ws.agent.summary(agentId) → summary  // Quick summary of what another agent did.',
  '  ws.agent.reportToParent(report) → { ok, ... }  // Send a concise completion/update report to the parent agent. Only works for delegated agents; user-created agents will get an error.',
  '',
  '  ws.event.recentFiles(limit?) → [files]  // Recently modified files. Default limit is 10.',
  '  ws.event.agentActivity(agentId?, minutesAgo?) → [events]  // With `agentId`, narrows to that agent; otherwise returns recent activity window.',
  '  ws.event.workspaceSummary(minutesAgo?) → summary  // Aggregated workspace activity summary.',
  '  ws.event.directoryChanges(dir, limit?) → [changes]  // Recent file changes under one directory prefix.',
  '  ws.event.query({ eventType?, actorType?, actorId?, path?, minutesAgo?, limit? }) → [events]  // Advanced event query filters.',
  '  ws.event.subscribe(eventTypes, { excludeSelf?, batchWindow? }) → { subscriptionId, eventTypes }  // Subscribe to batched workspace events. `eventTypes` must be an array: `["agent:*", "file:*"]`. Use explicit categories or event types such as `agent:*`, `file:*`, `task:*`, `git:*`, `note:*`, `terminal:*`, `test:*`, `build:*`, `workspace:*`, `spec:*`, `goal:*`, `comment:*`.',
  '    Prefer explicit categories over bare `*`; `excludeSelf` defaults to true and `batchWindow` defaults to 500ms.',
  '  ws.event.unsubscribe(subscriptionId) → { ok, subscriptionId }  // Removes one event subscription.',
  '',
  '  ws.script.list() → [scripts]  // Lists saved scripts with runtime status when available.',
  '  ws.script.create(name, command, mode, { cwd?, env?, category?, autoStart?, scriptId? }) → { id }  // Create or update a saved script. `mode="service"` is for long-running auto-restart processes; `mode="command"` runs once to completion.',
  '  ws.script.remove(scriptId) → { ok, scriptId }  // Stops and removes a saved script definition.',
  '  ws.script.start(scriptId) → { ok, scriptId }  // Starts an existing script.',
  '  ws.script.stop(scriptId) → { ok, scriptId }  // Stops a running script.',
  '  ws.script.restart(scriptId) → { ok, scriptId }  // Stops then restarts a script.',
  '  ws.script.output(scriptId, maxLines?) → string  // Returns recent output buffer text.',
  '  ws.script.status(scriptId) → status  // Runtime state, pid, exit code, detected URL, timings.',
  '  ws.script.run(scriptId, { maxLines?, timeoutSeconds? }) → { exitCode?, output, timedOut?, warning? }  // Run a command-mode script and wait for it to finish. Use this for builds/tests/linting, not long-running services.',
  '    `timeoutSeconds` defaults to 30. If the timeout is hit, it returns partial output with `timedOut=true`. For service-mode scripts it returns a warning telling you to use `ws.script.start()` instead.',
  '',
  '  ws.browser.exec(actions, tabId?) → result | results[]  // Chrome DevTools browser automation. Each action is an object with an `action` field; common actions include `listTabs`, `focusTab`, `getAccessibilityTree`, `screenshot`, `evaluate`, `navigate`, `openTab`, `snapshot`, and capture/trace actions.',
  '    Single-action calls return one result; multiple actions return an array. Use `ws.browser.docs("overview"|"capture"|"examples")` for the full action reference, `waitFor` options, and longer examples.',
  '  ws.browser.docs(topic) → string  // Browser API docs. Topics include `overview`, `capture`, and `examples`.',
  '',
  '  ws.terminal.list() → [terminals]  // Active workspace terminal sessions.',
  '  ws.terminal.readOutput(terminalId, maxLines?) → string  // Read a terminal output buffer. Use `ws.terminal.list()` first to discover terminal IDs.',
  '',
  '  ws.crossWorkspace.listSiblings() → [workspaces]  // Other workspaces sharing the same repository (repo-scoped; not usable in the Chief workspace — use ws.app.workspaces.list there).',
  '  ws.crossWorkspace.readNote(targetWorkspaceId, noteId) → note  // Read a note from another sibling workspace in the same repository. Use `listSiblings()` first to discover valid workspace IDs; use noteId=`spec` for its spec.',
  '  ws.crossWorkspace.listNotes(targetWorkspaceId) → [notes]  // List notes in another sibling workspace. Use this before `readNote()` if you do not know which note IDs exist there.',
  '',
  '  ws.file.read(path) → string  // Read an actual project file relative to workspace root. Do not use this for notes/spec content; use `ws.note.read()` for workspace notes. Paths outside the workspace are rejected.',
  '  ws.file.write(path, content) → { ok, path, size }  // Writes/creates a file inside the workspace and records attribution.',
  '  ws.file.list(path?) → [{ name, type }]  // Lists files/directories. Default path is `.`.',
  '  ws.file.delete(path) → { ok, path, deleted }  // Deletes a file. Directories must use other tooling.',
  '  ws.file.mkdir(path) → { ok, path, created?|existed? }  // Creates a directory inside the workspace.',
  '  ws.file.rename(oldPath, newPath) → { ok, oldPath, newPath }  // Renames/moves a file or directory inside the workspace.',
  '',
  'Examples:',
  '  return await ws.workspace.info()',
  '',
  '  const [spec, tasks, agents] = await Promise.all([',
  '    ws.note.read("spec"),',
  '    ws.note.listTasks("spec"),',
  '    ws.agent.list(),',
  '  ])',
  '  return { specTitle: spec.title, taskCount: tasks.length, agentCount: agents.length }',
  '',
  '  const note = await ws.note.read("spec")',
  '  if (!note.content.includes("## Phase 2")) {',
  '    await ws.note.add("spec", { heading: "## Phase 2", content: "Draft plan", position: "end" })',
  '  }',
  '  return await ws.workspace.details()',
  '',
  '  // N+1 pattern: list items, then batch-read details in one call',
  '  const tasks = await ws.note.listTasks("spec")',
  '  const taskNoteIds = tasks.filter(t => t.taskNoteId).map(t => t.taskNoteId)',
  '  const taskNotes = await Promise.all(taskNoteIds.map(id => ws.task.getMyTask(id)))',
  '  return taskNotes.map(t => ({ id: t.noteId, title: t.title, status: t.status }))',
].join('\n');

export class WorkspaceJsApiTool extends BaseMCPTool {
  constructor(
    private workspacePath: string,
    private workspaceId: string,
    private workspaceManager?: any,

    _eventEmitter?: any,
  ) {
    super(
      'workspace_api',
      TOOL_DESCRIPTION,
      createInputSchema(
        {
          code: stringProperty('JavaScript code to execute'),
          summary: stringProperty(
            'Short human-readable summary of what this call does, shown in the UI (e.g., "Reading spec and listing tasks")',
          ),
        },
        ['code', 'summary'],
      ),
    );
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const { code } = call.arguments;
    if (!code || typeof code !== 'string') {
      return this.error('`code` is required and must be a string');
    }

    const logs: string[] = [];
    const capture = (...args: any[]) => logs.push(args.map(String).join(' '));
    const consoleMock = {
      log: capture,
      info: capture,
      warn: capture,
      error: capture,
      debug: capture,
    };

    const formatOutput = (logs: string[], body: string) =>
      logs.length > 0 ? `${logs.join('\n')}\n\n${body}` : body;

    let ws: any;
    try {
      ws = await this.buildWs(call);
    } catch (err: any) {
      return this.error(
        formatOutput(logs, `Error building workspace API: ${err?.message ?? String(err)}`),
      );
    }

    const wrapped = `(async () => { ${code} })()`;

    try {
      const result = await runInNewContext(
        wrapped,
        {
          ws,
          Promise,
          JSON,
          Date,
          console: consoleMock,
        },
        { timeout: TIMEOUT_MS },
      );

      // Check if the result contains MCP content items (e.g. image content from readAsset)
      if (result && typeof result === 'object' && Array.isArray(result.__mcpContentItems)) {
        const contentItems = result.__mcpContentItems;
        if (logs.length > 0) {
          contentItems.unshift({ type: 'text', text: logs.join('\n') });
        }
        return this.result(contentItems);
      }

      const output = result !== undefined ? JSON.stringify(result, null, 2) : '(no return value)';
      return this.success(formatOutput(logs, output));
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      let errorText: string;

      if (err?.name === 'SyntaxError') {
        // Syntax errors report positions relative to the wrapper, which is confusing.
        // Give a clearer message pointing at the user's code.
        errorText = `SyntaxError in your code: ${msg}. Check for unclosed brackets, braces, quotes, or template literals.`;
      } else if (err?.name === 'TypeError' && msg.includes('Cannot read properties of undefined')) {
        // e.g. ws.database.query() → "Cannot read properties of undefined (reading 'query')"
        // Make it clearer that the namespace doesn't exist.
        const match = msg.match(/\(reading '([^']+)'\)/);
        const prop = match?.[1];
        errorText = prop
          ? `TypeError: Attempted to call '${prop}' on an undefined object. Check that the namespace exists on the \`ws\` object (e.g. ws.note, ws.agent, ws.event, etc.).`
          : `TypeError: ${msg}`;
      } else {
        errorText = `Error: ${msg}`;
      }

      const metadata =
        err?.code || err?.details
          ? {
              error:
                typeof err.toJSON === 'function'
                  ? err.toJSON()
                  : { code: err.code, details: err.details },
            }
          : undefined;
      return this.error(formatOutput(logs, errorText), metadata);
    }
  }

  private async buildWs(call: ToolCall) {
    const app =
      this.workspaceId === CHIEF_WORKSPACE_ID
        ? {
            agents: buildWsAppAgentsApi(this.workspaceManager),
            proposal: buildWsAppProposalApi({ workspaceId: this.workspaceId, call }),
            settings: buildWsAppSettingsApi(this.workspaceId, call),
            specialists: buildWsAppSpecialistsApi(this.workspacePath, this.workspaceId, call),
            ui: buildAppUiApi({ workspaceId: this.workspaceId }),
            workspaces: buildWsAppWorkspacesApi(this.workspaceManager, call, this.workspaceId),
          }
        : undefined;

    return {
      workspace: buildWorkspaceApi({
        workspacePath: this.workspacePath,
        workspaceId: this.workspaceId,
        workspaceManager: this.workspaceManager,
        call,
      }),
      ...(app ? { app } : {}),
      ...buildNoteApi(this.workspaceManager, this.workspaceId, call),
      agent: buildAgentApi(this.workspaceId, this.workspacePath, call),
      event: buildWsEventApi(this.workspaceId, call),
      script: buildScriptApi(this.workspaceId),
      browser: buildBrowserApi(call),
      terminal: buildTerminalApi(this.workspaceId),
      crossWorkspace: buildCrossWorkspaceApi({
        workspaceId: this.workspaceId,
        workspaceManager: this.workspaceManager,
      }),
      file: buildFileApi({
        workspaceId: this.workspaceId,
        workspacePath: this.workspacePath,
        call,
      }),
    };
  }
}
