/** Serializable projection of an unmerged PR for the archive/delete warnings. */
export interface OpenPrWarningItem {
  number: number;
  title: string;
  /** May be '' when the wire url is empty and no repo owner/name is known to construct one. */
  url: string;
  status: 'Open' | 'Draft';
  mergeConflicts?: boolean;
}
