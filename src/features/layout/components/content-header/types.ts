import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

/**
 * Represents a single breadcrumb item in the header
 */
export interface BreadcrumbItem {
  /** Display label */
  label: string;
  /** Optional icon */
  icon?: IconDefinition;
  /** Click handler - if provided, the breadcrumb becomes a button */
  onClick?: () => void;
}
