/**
 * Download Attribution Claim
 *
 * On first app launch, collects a device fingerprint and calls the claim endpoint
 * on augmentcode.com to link the anonymous website visitor to the app user.
 *
 * The fingerprint must match what the browser sends during download:
 * - screen: "WxH" from primary display
 * - cores: CPU core count
 * - timezone: IANA timezone
 * - locale: system locale
 * - os_version: parsed from Electron's UA string (matches browser's frozen "10.15.7")
 *
 * Persistence uses the FE-local main-process prefs file (main/local-prefs):
 * - On success/no_match: stores result → no retry
 * - On network error/rate limit/5xx: stores nothing → natural retry next launch
 */

import { cpus } from 'os';
import { Logger } from '../shared/logger';
import { hasLocalPref, setLocalPref } from './local-prefs';

const logger = new Logger('DownloadAttribution');

const CLAIM_ENDPOINT = 'https://augmentcode.com/api/intent/claim-attribution';
const SETTINGS_KEY = 'downloadAttribution';

/** Stored attribution data in FE-local prefs */
export interface DownloadAttributionData {
  ajs_aid: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  confidence?: 'high' | 'low';
  download_location?: string | null;
  eventTracked: boolean;
}

interface ClaimResponse {
  matched: boolean;
  confidence?: 'high' | 'low';
  ajs_aid?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  download_location?: string | null;
  reason?: string;
}

/**
 * Attempt to claim download attribution on app startup.
 *
 * Must be called after app.whenReady() so that `screen` and `app` APIs are available.
 * Fire-and-forget — never blocks startup, all errors caught.
 */
export async function claimDownloadAttribution(): Promise<void> {
  try {
    // Already claimed or definitively no match — skip
    if (await hasLocalPref(SETTINGS_KEY)) {
      logger.debug('Attribution already claimed or no match — skipping');
      return;
    }

    // Collect fingerprint (must be after app.whenReady)
    const { screen, app, session } = await import('electron');
    const primaryDisplay = screen.getPrimaryDisplay();

    // Parse os_version from the UA string the same way the browser does.
    // Apple froze the UA at "Mac OS X 10_15_7" for all modern macOS versions,
    // so process.getSystemVersion() (e.g. "14.3.1") will NOT match.
    const ua = session.defaultSession.getUserAgent();
    const osMatch = ua.match(/Mac OS X (\d+[._]\d+[._]\d+)/);
    const os_version = osMatch ? osMatch[1].replace(/_/g, '.') : process.getSystemVersion();

    const fingerprint = {
      screen: `${primaryDisplay.size.width}x${primaryDisplay.size.height}`,
      cores: cpus().length,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: app.getLocale(),
      os_version,
    };

    logger.info(`Claiming download attribution: ${JSON.stringify(fingerprint)}`);

    // Call claim endpoint
    const response = await fetch(CLAIM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        // 429 Too Many Requests — rate limited, retry next launch
        logger.warn('Claim endpoint rate limited — will retry next launch', { status: response.status });
      } else if (response.status >= 400 && response.status < 500) {
        // 4xx (except 429) — client error, terminal (retrying won't help)
        const attribution: DownloadAttributionData = {
          ajs_aid: null,
          eventTracked: true,
        };
        await setLocalPref(SETTINGS_KEY, attribution);
        logger.warn('Claim endpoint returned client error — will not retry', { status: response.status });
      } else {
        // 5xx or unexpected — transient, retry next launch
        logger.warn('Claim endpoint returned server error — will retry next launch', { status: response.status });
      }
      return;
    }

    const data: ClaimResponse = await response.json();

    if (data.matched) {
      // Success — store attribution data permanently
      const attribution: DownloadAttributionData = {
        ajs_aid: data.ajs_aid ?? null,
        utm_source: data.utm_source,
        utm_medium: data.utm_medium,
        utm_campaign: data.utm_campaign,
        utm_content: data.utm_content,
        utm_term: data.utm_term,
        confidence: data.confidence,
        download_location: data.download_location,
        eventTracked: false,
      };
      await setLocalPref(SETTINGS_KEY, attribution);
      logger.info('Attribution claimed successfully', {
        has_ajs_aid: !!data.ajs_aid,
        confidence: data.confidence,
      });
    } else if (data.reason === 'no_match' || data.reason === 'missing_fingerprint') {
      // Terminal — store marker to prevent future retries
      const attribution: DownloadAttributionData = {
        ajs_aid: null,
        eventTracked: true, // Nothing to track
      };
      await setLocalPref(SETTINGS_KEY, attribution);
      logger.info('No attribution match found', { reason: data.reason });
    } else if (data.reason === 'rate_limited') {
      // Transient — don't persist, retry next launch
      logger.warn('Attribution claim rate limited — will retry next launch');
    }
    // For any other reason or unexpected response, don't persist → retry next launch
  } catch (error) {
    // Network error, timeout, JSON parse error, etc. — don't persist, retry next launch
    logger.warn('Attribution claim failed — will retry next launch', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

