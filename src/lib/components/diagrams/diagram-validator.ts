/**
 * Diagram Validation Utilities
 *
 * Validates diagram primitives and provides helpful error messages
 */

import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import { DiagramPrimitiveSchema } from '$shared/types/notes-primitives';

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
      message: 'Duplicate node IDs found',
      severity: 'error',
    });
  }

  // Check edge references
  d.model.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        field: `model.edges[${i}].from`,
        message: `Edge references non-existent node: ${edge.from}`,
        severity: 'error',
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        field: `model.edges[${i}].to`,
        message: `Edge references non-existent node: ${edge.to}`,
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
            message: `Group references non-existent node: ${nodeId}`,
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
          message: `State references non-existent node: ${nodeId}`,
          severity: 'warning',
        });
      }
    });

    const edgeIds = new Set(d.model.edges.map((e) => e.id));
    state.visibleEdges?.forEach((edgeId) => {
      if (!edgeIds.has(edgeId)) {
        warnings.push({
          field: `states[${i}].visibleEdges`,
          message: `State references non-existent edge: ${edgeId}`,
          severity: 'warning',
        });
      }
    });

    if (state.camera?.focus && !nodeIds.has(state.camera.focus)) {
      warnings.push({
        field: `states[${i}].camera.focus`,
        message: `Camera focus references non-existent node: ${state.camera.focus}`,
        severity: 'warning',
      });
    }
  });

  // Warnings for best practices
  if (d.model.nodes.length === 0) {
    warnings.push({
      field: 'model.nodes',
      message: 'Diagram has no nodes',
      severity: 'warning',
    });
  }

  if (d.model.edges.length === 0 && d.model.nodes.length > 1) {
    warnings.push({
      field: 'model.edges',
      message: 'Diagram has multiple nodes but no edges',
      severity: 'warning',
    });
  }

  if (d.states && d.states.length > 0 && !d.states.some((s) => s.narrative)) {
    warnings.push({
      field: 'states',
      message: 'States exist but none have narratives - consider adding explanatory text',
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
    parts.push('Errors:');
    result.errors.forEach((err) => {
      parts.push(`  - ${err.field}: ${err.message}`);
    });
  }

  if (result.warnings.length > 0) {
    parts.push('Warnings:');
    result.warnings.forEach((warn) => {
      parts.push(`  - ${warn.field}: ${warn.message}`);
    });
  }

  return parts.join('\n');
}
