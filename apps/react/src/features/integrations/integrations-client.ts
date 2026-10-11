import { LiveIntegrationsClientCore } from '$lib/client/live/live-integrations-client-core';
import { backend } from '../backend/backend-transport';

/** Shared live domain only; never construct the legacy renderer's AppClient. */
export const integrationsClient = new LiveIntegrationsClientCore(backend);
