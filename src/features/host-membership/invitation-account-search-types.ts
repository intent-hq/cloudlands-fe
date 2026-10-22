export interface InvitationAccountQuery {
  provider: 'github' | 'gitlab';
  host: string;
  query: string;
}
export interface InvitationAccount {
  identity: { provider: 'github' | 'gitlab'; host: string; externalUserId: string };
  login: string;
  name: string | null;
  avatarUrl: string | null;
}
export interface InvitationAccountSuggestions {
  request: InvitationAccountQuery | null;
  users: InvitationAccount[];
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
  error: string | null;
}
