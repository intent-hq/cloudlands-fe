/**
 * Diagram Validation Utilities
 *
 * Validates diagram primitives and provides helpful error messages
 */

import { DiagramPrimitiveSchema } from '$shared/types/notes-primitives';
import { m } from '$shared/paraglide/messages.js';

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validate a diagram primitive
 */
export function validateDiagram(diagram: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Schema validation
  const schemaResult = DiagramPrimitiveSchema.safeParse(diagram);
  if (!schemaResult.success) {
    schemaResult.error.errors.forEach((err) => {
      errors.push({
        field: err.path.join('.'),
        message: err.message,
        severity: 'error',
      });
    });
    return { valid: false, errors, warnings };
  }

  const d = schemaResult.data;

  // Semantic validation
  const nodeIds = new Set(d.model.nodes.map((n) => n.id));

  // Check for duplicate node IDs
  if (nodeIds.size !== d.model.nodes.length) {
    errors.push({
      field: 'model.nodes',
      message: m.diagram_validator_duplicateNodeIds_error(),
      severity: 'error',
    });
  }

  // Check edge references
  d.model.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        field: `model.edges[${i}].from`,
        message: m.diagram_validator_edgeNonexistentNode_error({ nodeId: edge.from }),
        severity: 'error',
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        field: `model.edges[${i}].to`,
        message: m.diagram_validator_edgeNonexistentNode_error({ nodeId: edge.to }),
        severity: 'error',
      });
    }
  });

  // Check group references
  d.model.groups?.forEach((group, i) => {
    if (Array.isArray(group.nodeIds)) {
      group.nodeIds.forEach((nodeId) => {
        if (!nodeIds.has(nodeId)) {
          errors.push({
            field: `model.groups[${i}].nodeIds`,
            message: m.diagram_validator_groupNonexistentNode_error({ nodeId }),
            severity: 'error',
          });
        }
      });
    }
  });

  // Check state references
  d.states?.forEach((state, i) => {
    state.visibleNodes?.forEach((nodeId) => {
      if (!nodeIds.has(nodeId)) {
        warnings.push({
          field: `states[${i}].visibleNodes`,
          message: m.diagram_validator_stateNonexistentNode_error({ nodeId }),
          severity: 'warning',
        });
      }
    });

    const edgeIds = new Set(d.model.edges.map((e) => e.id));
    state.visibleEdges?.forEach((edgeId) => {
      if (!edgeIds.has(edgeId)) {
        warnings.push({
          field: `states[${i}].visibleEdges`,
          message: m.diagram_validator_stateNonexistentEdge_error({ edgeId }),
          severity: 'warning',
        });
      }
    });

    if (state.camera?.focus && !nodeIds.has(state.camera.focus)) {
      warnings.push({
        field: `states[${i}].camera.focus`,
        message: m.diagram_validator_cameraFocusNonexistentNode_error({ nodeId: state.camera.focus }),
        severity: 'warning',
      });
    }
  });

  // Warnings for best practices
  if (d.model.nodes.length === 0) {
    warnings.push({
      field: 'model.nodes',
      message: m.diagram_validator_noNodes_warning(),
      severity: 'warning',
    });
  }

  if (d.model.edges.length === 0 && d.model.nodes.length > 1) {
    warnings.push({
      field: 'model.edges',
      message: m.diagram_validator_noEdges_warning(),
      severity: 'warning',
    });
  }

  if (d.states && d.states.length > 0 && !d.states.some((s) => s.narrative)) {
    warnings.push({
      field: 'states',
      message: m.diagram_validator_noNarratives_warning(),
      severity: 'warning',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(result: ValidationResult): string {
  const parts: string[] = [];

  if (result.errors.length > 0) {
    parts.push(m.diagram_validator_errors_label());
    result.errors.forEach((err) => {
      parts.push(`  - ${err.field}: ${err.message}`);
    });
  }

  if (result.warnings.length > 0) {
    parts.push(m.diagram_validator_warnings_label());
    result.warnings.forEach((warn) => {
      parts.push(`  - ${warn.field}: ${warn.message}`);
    });
  }

  return parts.join('\n');
}
