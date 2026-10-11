/** Progress of the initial daemon transcript page; shared reducer contract only. */
export interface InitialChatHistory {
  target: number;
  received: number;
  complete: boolean;
}
