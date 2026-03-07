/**
 * Analytics Event Types
 *
 * Type-safe definitions for all analytics events tracked in the app.
 * Follows Augment's Event Tracking Specification.
 *
 * NAMING CONVENTIONS:
 * - Event names: Title Case, Past Tense, Verb + Object (e.g., "Created Workspace")
 * - Property names: snake_case, lowercase, flat structure
 *
 * ⚠️  PRIVACY GUIDELINES - DO NOT TRACK:
 * - Repo paths or names (reveals company/project names)
 * - File paths (reveals codebase structure)
 * - Branch names (may contain ticket IDs, feature names)
 * - Message/prompt content (user's actual work)
 * - Note content (user's specs and plans)
 * - SSH keys or credentials
 *
 * ✅ SAFE TO TRACK:
 * - Opaque IDs (workspace, agent UUIDs)
 * - Counts and lengths (not content)
 * - Booleans and enums
 * - Timestamps and durations
 * - Platform info (os, version)
 * - Workspace titles (user-generated but acceptable for analytics)
 * - Agent names (user-generated but acceptable for analytics)
 */

/**
 * Common properties attached to ALL events via the analytics wrapper.
 * These are automatically added - don't include in individual event types.
 */
export interface CommonEventProperties {
  environment: 'production' | 'development';
  app_version: string;
  client: 'intent_desktop';
  platform: 'darwin' | 'win32' | 'linux';

  // UI context properties (nullable - may not be available outside workspace context)
  route_name: 'home' | 'workspace' | 'settings' | 'creating' | 'agent' | null;
  main_panel_type: string | null; // e.g., 'notes', 'file', 'diff', 'agent', 'browser', 'terminal', 'code-review', etc.
  sidebar_active_tab:
    | 'notes'
    | 'changes'
    | 'files'
    | 'activity'
    | 'agents'
    | 'terminals'
    | 'browser'
    | null;
  workspace_title: string | null;
}

/**
 * Context returned by the analytics context provider.
 * Set by workspace pages to provide current UI state.
 */
export interface AnalyticsUIContext {
  routeName: 'home' | 'workspace' | 'settings' | 'creating' | 'agent' | null;
  mainPanelType: string | null;
  sidebarActiveTab:
    | 'notes'
    | 'changes'
    | 'files'
    | 'activity'
    | 'agents'
    | 'terminals'
    | 'browser'
    | null;
  workspaceTitle: string | null;
}

/**
 * Function type for the analytics context provider.
 * Returns current UI context or null if not in a workspace.
 */
export type AnalyticsContextProvider = () => AnalyticsUIContext | null;

/**
 * Properties added dynamically per track() call (not cached at init).
 */
export interface DynamicEventProperties {
  /** The currently active ACP provider (read fresh from localStorage on each event) */
  provider_id: string;
}

/**
 * User traits for identify calls.
 */
export interface UserTraits {
  tenant_id?: string;
  tenant_name?: string;
  app_version?: string;
  platform?: 'darwin' | 'win32' | 'linux';
  client?: 'intent_desktop';
  created_at?: string;
  plan?: string;
}

/** Trigger source for git operations */
export type GitOpTrigger = 'manual' | 'agent' | 'auto_commit';

/** Common context for git operations that can be triggered by agents */
type GitOpContext = {
  trigger?: GitOpTrigger;
  agent_id?: string;
};

/** Common context for git operations that are manual-only */
type ManualGitOpContext = {
  trigger?: 'manual';
};

/**
 * All trackable events and their properties.
 * Property names use snake_case per spec.
 */
export interface AnalyticsEvents {
  // ============================================
  // App Lifecycle
  // ============================================
  'Opened App': {
    // Common properties added automatically
  };

  // ============================================
  // Workspace Events (no repo names/paths!)
  // ============================================
  'Created Workspace': {
    workspace_id: string;
    workspace_title?: string;
    is_remote: boolean;
    from_template: boolean;
    work_mode?: 'team' | 'single';
  };
  'Opened Workspace': {
    workspace_id: string;
    workspace_title?: string;
    age_in_days?: number;
  };
  'Deleted Workspace': {
    workspace_id: string;
    workspace_title?: string;
    age_in_days?: number;
  };

  // ============================================
  // Agent Events
  // ============================================
  'Created Agent': {
    agent_id: string;
    workspace_id: string;
    agent_name?: string;
    agent_model?: string;
    source?: string;
  };
  'Sent Agent Message': {
    agent_id: string;
    workspace_id: string;
    message_length: number; // Length only, not content
    agent_name?: string;
    agent_model?: string;
  };
  'Stopped Agent': {
    agent_id: string;
    workspace_id: string;
    run_duration_ms?: number;
    agent_name?: string;
    agent_model?: string;
  };

  // ============================================
  // Feature Usage (specific events per feature)
  // ============================================
  'Opened Terminal': {
    workspace_id: string;
    source?: string;
  };
  'Opened PR Creator': {
    workspace_id: string;
  };
  'Opened File': {
    workspace_id: string;
    file_extension?: string; // e.g., "ts", "py" - no full path
    source?: string;
  };
  'Created File': {
    workspace_id: string;
    file_extension?: string;
  };
  'Renamed File': {
    workspace_id: string;
    old_extension?: string;
    new_extension?: string;
    extension_changed?: boolean;
  };
  'Deleted File': {
    workspace_id: string;
    file_extension?: string;
  };
  'Opened Note': {
    workspace_id: string;
    note_id: string;
    note_type: 'spec' | 'custom';
  };
  'Opened Settings': Record<string, never>;

  // ============================================
  // Git Actions (action type only, no branch names or messages)
  // ============================================
  'Committed Changes': {
    workspace_id: string;
    success: boolean;
  } & GitOpContext;
  'Pushed Changes': {
    workspace_id: string;
    success: boolean;
    commit_count?: number;
    has_pr?: boolean;
  } & GitOpContext;
  'Created Pull Request': {
    workspace_id: string;
    success: boolean;
  } & GitOpContext;
  'Merged Changes': {
    workspace_id: string;
    success: boolean;
  } & ManualGitOpContext;
  'Merged Pull Request on GitHub': {
    workspace_id: string;
    pr_number: number;
    merge_method: string;
    success: boolean;
  } & ManualGitOpContext;

  // ============================================
  // Settings Events
  // ============================================
  'Selected Provider': {
    provider_id: string;
    previous_provider_id: string | null;
  };
  'Changed Theme': {
    theme: string; // 'light' | 'dark' | 'system' or preset name
    previous_theme?: string;
    source?: string; // 'toggle' | 'preset' | 'reset'
  };
  'Created Specialist': {
    specialist_name?: string;
    has_custom_prompt: boolean;
  };
  'Deleted Specialist': {
    specialist_id: string;
    specialist_name?: string;
  };
  'Enabled Context Engine': {
    provider_id: string;
    success: boolean;
  };
  'Disabled Context Engine': {
    provider_id: string;
    success: boolean;
  };

  // ============================================
  // Navigation (auto-tracked, see spec note)
  // ============================================
  'Viewed Page': {
    page_name: 'home' | 'workspace' | 'settings' | 'agent' | 'creating';
    page_type: 'app';
  };

  // ============================================
  // Browser Events
  // ============================================
  'Opened Browser Panel': {
    url_domain: string;
    source?: 'sidebar' | 'link_click' | 'terminal' | 'agent_chat' | 'address_bar' | 'direct';
  };
  'Navigated Browser': {
    url_domain: string;
  };
  'Opened External Browser': {
    url_domain: string;
  };

  // ============================================
  // Link Click Events
  // ============================================
  'Clicked Link From Terminal': {
    url_domain: string;
    workspace_id: string;
  };
  'Clicked Link From Chat': {
    url_domain: string;
    workspace_id: string;
    agent_id?: string;
  };

  // ============================================
  // Diff & Code Review Events
  // ============================================
  'Viewed Diff': {
    file_extension: string;
    change_type: 'modified' | 'added' | 'deleted' | 'renamed';
    is_staged: boolean;
  };
  'Applied Chat Diff': {
    file_extension: string;
  };
  'Rejected Chat Diff': {
    file_extension: string;
  };
  'Staged Changes': {
    method: 'file' | 'hunk' | 'lines';
    file_count?: number;
  } & GitOpContext;
  'Requested Code Review': {
    staged_file_count: number;
  };

  // ============================================
  // Note Events
  // ============================================
  'Created Note': {
    note_type: 'task' | 'regular' | string;
    source?: string;
  };
  'Deleted Note': {
    note_type: 'task' | 'regular' | string;
    note_age_days?: number;
  };
  'Edited Note': {
    note_type: 'task' | 'regular' | string;
    note_id: string;
  };

  // ============================================
  // Command Palette Events
  // ============================================
  'Used Command Palette': {
    action_type: 'file' | 'command' | 'symbol' | string;
    query_length: number;
  };

  // ============================================
  // Agent Lifecycle Events
  // ============================================
  'Agent Turn Completed': {
    agent_id: string;
    agent_name?: string;
    agent_model?: string;
    duration_ms?: number;
    tool_call_count?: number;
  };
  'Agent Errored': {
    agent_id: string;
    agent_name?: string;
    error_type?: string;
  };

  // ============================================
  // Git & Workspace Events
  // ============================================
  'Renamed Workspace': {
    workspace_id: string;
  };
  'Undid Commit': {
    workspace_id: string;
    commit_count: number;
    success: boolean;
  } & ManualGitOpContext;
  'Undid Push': {
    workspace_id: string;
    success: boolean;
  } & ManualGitOpContext;
  'Switched Branch': {
    workspace_id: string;
  } & GitOpContext;

  // ============================================
  // Setup Funnel Events
  // ============================================
  'Started Setup': {
    // Fires when ProviderStatusPanel mounts (first-time user sees provider chooser)
  };
  'Installed CLI': {
    auggie_version?: string;
  };
  'Started Authentication': {
    // Fires when user clicks Login button for Auggie
  };
  'Completed Authentication': {
    method: 'auto' | 'browser_poll' | 'manual_paste';
  };
  'Completed Setup': {
    provider_id: string;
  };

  // ============================================
  // Onboarding
  // ============================================
  'Viewed Onboarding': {
    step: number;
  };
  'Completed Onboarding': {
    skipped: boolean;
    final_step: number;
  };

  // ============================================
  // Attribution (one-time, on first launch after download)
  // ============================================
  'Claimed Download Attribution': {
    confidence: 'high' | 'low';
    download_location: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    has_ajs_aid: boolean;
  };
}

/**
 * Event names as a union type
 */
export type AnalyticsEventName = keyof AnalyticsEvents;

/**
 * Get properties type for a specific event
 */
export type EventProperties<T extends AnalyticsEventName> = AnalyticsEvents[T];

/**
 * Analytics configuration from main process
 */
export interface AnalyticsConfig {
  writeKey: string | null;
  enabled: boolean;
}
