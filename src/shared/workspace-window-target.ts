/** Exact transcript destinations transported to a normal workspace renderer. */
export type WorkspaceWindowTarget =
  | {
      type: 'file';
      filePath: string;
      line?: number;
      gitRootId?: string;
      gitRootPath?: string;
    }
  | { type: 'note'; noteId: string };
