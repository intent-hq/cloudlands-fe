/**
 * Segment Analytics Client
 *
 * Singleton wrapper around @segment/analytics-next for the renderer process.
 * Fetches configuration from the main process via IPC.
 *
 * Follows Augment's Event Tracking Specification:
 * - Automatically attaches common properties to all events
 * - Uses snake_case for property names
 * - Title Case, Past Tense for event names
 */

import {
  AnalyticsBrowser,
  type Analytics,
} from '@segment/analytics-next';
import { createLogger } from '$lib/utils/client-logger';
import { invoke } from '$shared/generated/ipc-client';
import type {
  AnalyticsConfig,
  AnalyticsEventName,
  AnalyticsContextProvider,
  DynamicEventProperties,
  EventProperties,
  UserTraits,
  CommonEventProperties,
} from './types';

const logger = createLogger('analytics');

// Singleton instance
let analyticsInstance: Analytics | null = null;
let isInitialized = false;
let isInitializing = false;

// Cached static common properties (set during initialization)
let staticCommonProperties: Omit<
  CommonEventProperties,
  'route_name' | 'main_panel_type' | 'sidebar_active_tab' | 'workspace_title'
> | null = null;

// Context provider for dynamic UI context (set by workspace pages)
let contextProvider: AnalyticsContextProvider | null = null;

// Guard to prevent duplicate identify() calls within a session
let hasIdentified = false;

/**
 * Set the analytics context provider.
 * Called by workspace pages to register a callback that returns current UI state.
 * The provider function is called on every track() call to get fresh context.
 *
 * @param provider A function that returns the current UI context, or null to clear
 */
export function setAnalyticsContextProvider(provider: AnalyticsContextProvider | null): void {
  contextProvider = provider;
}

/**
 * Build static common properties that are attached to all events.
 * These are computed once during initialization.
 * Dynamic UI context properties are added at track() time via the context provider.
 */
async function buildStaticCommonProperties(): Promise<
  Omit<
    CommonEventProperties,
    'route_name' | 'main_panel_type' | 'sidebar_active_tab' | 'workspace_title'
  >
> {
  // Get app version from main process
  let appVersion = 'unknown';
  try {
    const version =
      typeof window !== 'undefined' && window.electronAPI
        ? await invoke<string>('app:get-version')
        : undefined;
    if (version) appVersion = version;
  } catch {
    // Fallback to unknown
  }

  // Detect environment based on app packaging
  const isProduction =
    typeof window !== 'undefined' &&
    window.electronAPI &&
    // In production, the app is packaged
    !window.location.href.includes('localhost');

  return {
    environment: isProduction ? 'production' : 'development',
    app_version: appVersion,
    client: 'intent_desktop',
    platform: (navigator.platform.toLowerCase().includes('mac')
      ? 'darwin'
      : navigator.platform.toLowerCase().includes('win')
        ? 'win32'
        : 'linux') as CommonEventProperties['platform'],
  };
}

/**
 * Build the full common properties including dynamic UI context.
 * Called on every track() to get fresh UI context.
 */
function buildCommonProperties(): CommonEventProperties {
  // Get dynamic UI context from provider (if set)
  const uiContext = contextProvider?.() ?? null;

  return {
    ...(staticCommonProperties ?? ({} as NonNullable<typeof staticCommonProperties>)),
    route_name: uiContext?.routeName ?? null,
    main_panel_type: uiContext?.mainPanelType ?? null,
    sidebar_active_tab: uiContext?.sidebarActiveTab ?? null,
    workspace_title: uiContext?.workspaceTitle ?? null,
  };
}

/**
 * Get the current active provider ID from localStorage.
 * Read fresh on each call so it reflects mid-session provider switches.
 */
function getCurrentProviderId(): string {
  try {
    const stored = localStorage.getItem('workspaces-active-provider');
    if (stored) return stored;
  } catch {
    // Fallback to unknown
  }
  return 'unknown';
}

/**
 * Initialize the analytics client.
 * Fetches the write key from the main process and sets up Segment.
 * Safe to call multiple times - will only initialize once.
 */
export async function initAnalytics(): Promise<boolean> {
  if (isInitialized) {
    return true;
  }

  if (isInitializing) {
    // Wait for existing initialization
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (isInitialized || !isInitializing) {
          clearInterval(checkInterval);
          resolve(isInitialized);
        }
      }, 50);
    });
  }

  isInitializing = true;

  try {
    // Fetch config from main process
    const config = await fetchAnalyticsConfig();

    if (!config?.writeKey || !config.enabled) {
      logger.debug('[Analytics] Disabled or no write key configured');
      isInitializing = false;
      return false;
    }

    // Build static common properties once during initialization
    // Dynamic UI context properties are added at track() time
    staticCommonProperties = await buildStaticCommonProperties();

    // Initialize Segment
    const [analytics] = await AnalyticsBrowser.load({
      writeKey: config.writeKey,
    });

    // Apply download attribution anonymous ID BEFORE exposing analyticsInstance,
    // so no track() calls can fire with the wrong anonymous ID.
    // (track() guards on analyticsInstance, so we must not set it until after this.)
    await applyDownloadAttribution(analytics);

    analyticsInstance = analytics;
    isInitialized = true;
    isInitializing = false;

    logger.debug('[Analytics] Initialized successfully', {
      environment: staticCommonProperties.environment,
      app_version: staticCommonProperties.app_version,
    });
    return true;
  } catch (error) {
    console.warn('[Analytics] Failed to initialize:', error);
    isInitializing = false;
    return false;
  }
}

/**
 * Fetch analytics configuration from main process
 */
async function fetchAnalyticsConfig(): Promise<AnalyticsConfig | null> {
  try {
    const config =
      typeof window !== 'undefined' && window.electronAPI
        ? await invoke<AnalyticsConfig>('analytics:get-config')
        : undefined;
    return config as AnalyticsConfig;
  } catch (error) {
    console.warn('[Analytics] Failed to fetch config:', error);
    return null;
  }
}

/**
 * Apply download attribution anonymous ID if available.
 *
 * Reads the stored attribution data from the settings store (written by the main
 * process on first launch). If an ajs_aid exists, overrides Segment's auto-generated
 * anonymous ID so all events are linked to the website visitor who downloaded the app.
 *
 * Also tracks a one-time 'Claimed Download Attribution' event with UTM params.
 */
async function applyDownloadAttribution(analytics: Analytics): Promise<void> {
  try {
    const result =
      typeof window !== 'undefined' && window.electronAPI
        ? await invoke<any>('settings:get', {
          key: 'downloadAttribution',
        })
        : undefined;

    const attribution = result?.data;
    if (!attribution) return;

    // If there's no ajs_aid, there's nothing actionable — mark as tracked to
    // avoid re-evaluating on every launch and skip further processing.
    if (!attribution.ajs_aid) {
      if (!attribution.eventTracked) {
        if (typeof window !== 'undefined' && window.electronAPI) {
          await invoke('settings:set', {
            key: 'downloadAttribution',
            value: { ...attribution, eventTracked: true },
          });
        }
      }
      return;
    }

    // Set the anonymous ID from the website visitor's Segment profile
    analytics.setAnonymousId(attribution.ajs_aid);
    console.log('[Analytics] Set anonymous ID from download attribution');

    // Track the one-time attribution event
    if (!attribution.eventTracked) {
      const enrichedProperties = {
        ...buildCommonProperties(),
        confidence: attribution.confidence ?? 'low',
        download_location: attribution.download_location ?? null,
        utm_source: attribution.utm_source ?? null,
        utm_medium: attribution.utm_medium ?? null,
        utm_campaign: attribution.utm_campaign ?? null,
        utm_content: attribution.utm_content ?? null,
        utm_term: attribution.utm_term ?? null,
        has_ajs_aid: true,
      };
      analytics.track('Claimed Download Attribution', enrichedProperties);

      // Mark event as tracked so it doesn't fire again
      if (typeof window !== 'undefined' && window.electronAPI) {
        await invoke('settings:set', {
          key: 'downloadAttribution',
          value: { ...attribution, eventTracked: true },
        });
      }
      console.log('[Analytics] Tracked download attribution event');
    }
  } catch (error) {
    // Best-effort — don't break analytics initialization
    console.warn('[Analytics] Failed to apply download attribution:', error);
  }
}

/**
 * Get the analytics instance (may be null if not initialized)
 */
export function getAnalytics(): Analytics | null {
  return analyticsInstance;
}

/**
 * Check if analytics is ready
 */
export function isAnalyticsReady(): boolean {
  return isInitialized && analyticsInstance !== null;
}

/**
 * Track an event with type-safe properties.
 * Automatically attaches common properties (environment, app_version, etc.)
 * and dynamic UI context (route_name, main_panel_type, etc.).
 */
export function track<T extends AnalyticsEventName>(
  event: T,
  properties: EventProperties<T>,
): void {
  if (!analyticsInstance || !staticCommonProperties) {
    // In dev mode, log analytics events to console so developers can verify instrumentation
    if (
      typeof window !== 'undefined' &&
      window.location?.href &&
      (window.location.href.includes('localhost') || window.location.href.includes('127.0.0.1'))
    ) {
      console.log(`[Analytics:dev] ${event}`, properties);
    }
    return;
  }

  try {
    // Build common properties with dynamic UI context at call time
    const commonProps = buildCommonProperties();

    // Merge common properties with event-specific properties
    // provider_id is read fresh each time to reflect mid-session provider switches
    const dynamicProps: DynamicEventProperties = {
      provider_id: getCurrentProviderId(),
    };

    const enrichedProperties: CommonEventProperties & DynamicEventProperties & EventProperties<T> = {
      ...commonProps,
      ...dynamicProps,
      ...properties,
    };
    analyticsInstance.track(event, enrichedProperties);
  } catch (error) {
    console.warn('[Analytics] Failed to track event:', event, error);
  }
}

/**
 * Identify a user with traits
 */
export function identify(userId: string, traits?: UserTraits): void {
  if (!analyticsInstance) {
    return;
  }

  try {
    analyticsInstance.identify(userId, traits);
  } catch (error) {
    console.warn('[Analytics] Failed to identify user:', error);
  }
}

/**
 * Attempt to identify the current user via Augment API.
 * Fetches user info from the main process and calls identify() if available.
 * Gracefully skips if user info is not available (e.g., BYOK user, not logged in).
 *
 * Uses a dedupe guard — safe to call multiple times (e.g., on app open + auth success),
 * but only the first successful identify fires. Pass force=true to re-identify
 * (e.g., after mid-session login).
 */
export async function identifyUser(options?: { force?: boolean }): Promise<void> {
  if (!analyticsInstance) {
    return;
  }

  if (hasIdentified && !options?.force) {
    return;
  }

  try {
    const result =
      typeof window !== 'undefined' && window.electronAPI
        ? await invoke<any>('auggie:get-user-info')
        : undefined;
    if (result?.success && result.data?.id) {
      const traits: UserTraits = {};
      if (result.data.tenantId) traits.tenant_id = result.data.tenantId;
      if (result.data.tenantName) traits.tenant_name = result.data.tenantName;

      identify(result.data.id, traits);
      hasIdentified = true;
      logger.debug('[Analytics] User identified', { userId: result.data.id });
    }
  } catch (error) {
    // Gracefully skip — user may not be logged in to Augment
    logger.debug('[Analytics] Could not identify user (expected for BYOK users):', error);
  }
}

/**
 * Track a page view
 */
export function page(name?: string, properties?: Record<string, unknown>): void {
  if (!analyticsInstance) {
    return;
  }

  try {
    analyticsInstance.page(name, properties);
  } catch (error) {
    console.warn('[Analytics] Failed to track page:', error);
  }
}

/**
 * Reset analytics (e.g., on logout)
 */
export function reset(): void {
  if (!analyticsInstance) {
    return;
  }

  try {
    analyticsInstance.reset();
    hasIdentified = false;
  } catch (error) {
    console.warn('[Analytics] Failed to reset:', error);
  }
}
