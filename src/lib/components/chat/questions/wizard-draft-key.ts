export function wizardDraftKey(agentId: string, messageId: string): string {
  return `chat.questionWizardDraft/${agentId}/${messageId}`;
}
