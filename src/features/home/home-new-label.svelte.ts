/** A pending "New label…" request from a Home workspace menu. */
export interface HomeNewLabelRequest {
  workspaceId: string;
  /** Expand the new label's Home list group (`label:<name>`). */
  expandGroup: (key: string) => void;
  getHomeElement: () => HTMLElement | null;
}

let request = $state<HomeNewLabelRequest | null>(null);

/** Opens the New label dialog hosted by `HomeNewLabelHost` beside the Home page. */
export const homeNewLabel = {
  get request(): HomeNewLabelRequest | null {
    return request;
  },
  open(next: HomeNewLabelRequest): void {
    request = next;
  },
  close(): void {
    request = null;
  },
};
