import {
  getAppUiTargets,
  getHighlightIdFromRoute,
  type AppUiHighlightOptions,
  type AppUiHighlightPayload,
  type AppUiNavigateOptions,
  type AppUiNavigatePayload,
} from '$shared/app-ui-targets';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { Logger } from '$shared/logger';
import { sendToWorkspaceWindows } from '$features/system/main/system.ipc';

const logger = new Logger('WsAppUiApi');
const MAX_HIGHLIGHT_DURATION_MS = 30_000;

type SendToWorkspaceWindows = typeof sendToWorkspaceWindows;

type BuildAppUiApiDeps = {
  workspaceId: string;
  send?: SendToWorkspaceWindows;
};

function normalizeRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} is required and must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} cannot be empty`);
  }
  return normalized;
}

function normalizeDurationMs(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('durationMs must be a finite number when provided');
  }
  if (value <= 0 || value > MAX_HIGHLIGHT_DURATION_MS) {
    throw new Error(`durationMs must be between 1 and ${MAX_HIGHLIGHT_DURATION_MS}`);
  }
  return Math.round(value);
}

function normalizeOptions<T extends object>(options: unknown, name: string): T {
  if (options === undefined || options === null) return {} as T;
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error(`${name} must be an object when provided`);
  }
  return options as T;
}

export function buildAppUiApi({ workspaceId, send = sendToWorkspaceWindows }: BuildAppUiApiDeps) {
  return {
    async navigate(route: string, options?: AppUiNavigateOptions) {
      const normalizedRoute = normalizeRequiredString(route, 'route');
      const normalizedOptions = normalizeOptions<AppUiNavigateOptions>(options, 'options');
      const highlightId = (
        normalizedOptions.highlightId ??
        getHighlightIdFromRoute(normalizedRoute) ??
        ''
      ).trim();
      const durationMs = normalizeDurationMs(normalizedOptions.durationMs);
      const payload: AppUiNavigatePayload = {
        route: normalizedRoute,
        workspaceId,
        ...(highlightId ? { highlightId } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      };

      logger.debug('ws.app.ui.navigate', { workspaceId, route: normalizedRoute, highlightId });
      send(workspaceId, IPC_CHANNELS.APP.UI_NAVIGATE, payload);
      return { ok: true, ...payload };
    },

    async highlight(id: string, options?: AppUiHighlightOptions) {
      const normalizedId = normalizeRequiredString(id, 'id');
      const normalizedOptions = normalizeOptions<AppUiHighlightOptions>(options, 'options');
      const durationMs = normalizeDurationMs(normalizedOptions.durationMs);
      const payload: AppUiHighlightPayload = {
        id: normalizedId,
        workspaceId,
        ...(durationMs !== undefined ? { durationMs } : {}),
      };

      logger.debug('ws.app.ui.highlight', { workspaceId, id: normalizedId, durationMs });
      send(workspaceId, IPC_CHANNELS.APP.UI_HIGHLIGHT, payload);
      return { ok: true, ...payload };
    },

    async targets() {
      logger.debug('ws.app.ui.targets', { workspaceId });
      return getAppUiTargets();
    },
  };
}
