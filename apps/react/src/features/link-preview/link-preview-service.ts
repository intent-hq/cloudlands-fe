import { createLinkPreviewService } from '$lib/client/live/link-preview-service';
import { integrationsClient } from '../integrations/integrations-client';
import { captureIntegrationContext } from '../integrations/integrations-request-context';

/** The real candidate integration domain, with no legacy AppClient/Store imports. */
export const linkPreviewService = createLinkPreviewService({
  getClient: () => integrationsClient,
  captureContext: captureIntegrationContext,
});
