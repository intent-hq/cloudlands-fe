import type { Capability, ControllerEffect, ControllerState, DraftInput } from './types';
import { hasUnsavedInput } from './reducer';

function needsDelivery(input: DraftInput): boolean {
  return input.intentText.trim().length > 0 || input.attachments.length > 0;
}

export function effectsFor(state: ControllerState): ControllerEffect[] {
  switch (state.phase) {
    case 'boot':
      return [{ type: 'identifyBackend', generation: state.generation }];
    case 'restoring':
      return state.draftId
        ? [{ type: 'restoreDraft', generation: state.generation, draftId: state.draftId }]
        : [];
    case 'pristine':
    case 'editing': {
      if (!state.draft) {
        return state.creationIssued
          ? []
          : [
              {
                type: 'createDraft',
                generation: state.generation,
                inputVersion: state.inputVersion,
                input: state.input,
              },
            ];
      }
      if (
        hasUnsavedInput(state) &&
        state.acknowledgedRevision !== null &&
        state.saveInFlightVersion !== state.inputVersion
      ) {
        return [
          {
            type: 'updateDraft',
            generation: state.generation,
            draftId: state.draft.id,
            expectedRevision: state.acknowledgedRevision,
            inputVersion: state.inputVersion,
            input: state.input,
          },
        ];
      }
      return [];
    }
    case 'starting': {
      const effects: ControllerEffect[] = [];
      if (
        state.draft &&
        hasUnsavedInput(state) &&
        state.acknowledgedRevision !== null &&
        state.saveInFlightVersion !== state.inputVersion
      ) {
        effects.push({
          type: 'updateDraft',
          generation: state.generation,
          draftId: state.draft.id,
          expectedRevision: state.acknowledgedRevision,
          inputVersion: state.inputVersion,
          input: state.input,
        });
      }
      for (const capability of Object.keys(state.requiredCapabilities) as Capability[]) {
        if (state.capabilities[capability] === 'pending') {
          effects.push({ type: 'probeCapability', generation: state.generation, capability });
        }
      }
      return effects;
    }
    case 'promoting':
      if (state.promoteAttempt === 'ack-lost') {
        return state.draftId
          ? [
              {
                type: 'reconcilePromotion',
                generation: state.generation,
                draftId: state.draftId,
                operationKey: state.operationKey,
              },
            ]
          : [];
      }
      if (
        state.promoteAttempt === 'not-issued' &&
        state.draftId &&
        state.acknowledgedRevision !== null
      ) {
        return [
          {
            type: 'promoteDraft',
            generation: state.generation,
            draftId: state.draftId,
            expectedRevision: state.acknowledgedRevision,
            operationKey: state.operationKey,
          },
        ];
      }
      return [];
    case 'adopting':
      return [
        { type: 'adoptWorkspace', generation: state.generation, workspaceId: state.workspaceId },
      ];
    case 'placingAttachments':
      return state.pendingAttachmentIds.length
        ? [
            {
              type: 'placeAttachments',
              generation: state.generation,
              workspaceId: state.workspaceId,
              attachmentIds: state.pendingAttachmentIds,
            },
          ]
        : [];
    case 'sending':
      if (
        (state.deliveryStage === 'needs-reconcile' || state.deliveryStage === 'unknown') &&
        state.draftId
      ) {
        return [
          { type: 'reconcileDelivery', generation: state.generation, draftId: state.draftId },
        ];
      }
      if (state.deliveryStage === 'ready' && state.draftId && needsDelivery(state.input)) {
        return [
          {
            type: 'sendFirstMessage',
            generation: state.generation,
            draftId: state.draftId,
            workspaceId: state.workspaceId,
            initialAgentId: state.initialAgentId,
            input: state.input,
          },
        ];
      }
      return [];
    case 'live':
    case 'failed':
    case 'offline':
    case 'conflict':
      return [];
  }
}
