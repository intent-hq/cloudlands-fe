/**
 * The SSH password or key passphrase typed in the wizard, handed to the saga
 * outside Redux so it never travels in an action or sits in state. Read once
 * per run; main keeps it for that run only.
 */
let secret: string | null = null;

export function stashSshSecret(value: string): void {
  secret = value;
}

export function takeSshSecret(): string | null {
  const value = secret;
  secret = null;
  return value;
}
