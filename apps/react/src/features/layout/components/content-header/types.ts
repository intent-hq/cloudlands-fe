import type { Icon } from '@phosphor-icons/react';

/** A category breadcrumb in a content panel header. */
export interface BreadcrumbItem {
  label: string;
  icon?: Icon;
  /** Providing a handler makes the breadcrumb a button. */
  onClick?: () => void;
}
