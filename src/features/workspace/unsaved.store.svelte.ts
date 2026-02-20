class UnsavedStore {
  #unsavedWorkspaces = $state<Set<string>>(new Set());

  get unsavedWorkspaces(): Set<string> {
    return this.#unsavedWorkspaces;
  }

  markWorkspaceUnsaved(workspaceId: string): void {
    this.#unsavedWorkspaces.add(workspaceId);
    // Trigger reactivity by reassigning
    this.#unsavedWorkspaces = new Set(this.#unsavedWorkspaces);
  }

  markWorkspaceSaved(workspaceId: string): void {
    this.#unsavedWorkspaces.delete(workspaceId);
    // Trigger reactivity by reassigning
    this.#unsavedWorkspaces = new Set(this.#unsavedWorkspaces);
  }

  clearUnsavedWorkspaces(): void {
    this.#unsavedWorkspaces = new Set();
  }

  isUnsaved(workspaceId: string): boolean {
    return this.#unsavedWorkspaces.has(workspaceId);
  }
}

export const unsavedStore = new UnsavedStore();
