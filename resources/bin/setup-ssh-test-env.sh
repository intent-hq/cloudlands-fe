#!/bin/bash
# setup-ssh-test-env.sh
# Run this as a NEW macOS user to set up SSH test scenarios for Intent.
# Usage: bash setup-ssh-test-env.sh <github-username>

set -e

GITHUB_USER="${1:?Usage: $0 <github-username>}"
SSH_DIR="$HOME/.ssh"
CUSTOM_KEY_DIR="$HOME/my-keys"
WORKTREE_DIR="$HOME/worktree-test"
PASSPHRASE="test-passphrase-123!"

echo "=== Setting up SSH test environment for Intent ==="
echo ""

# ── 1. Create directories ──────────────────────────────────────────────
mkdir -p "$SSH_DIR"
mkdir -p "$CUSTOM_KEY_DIR"
mkdir -p "$WORKTREE_DIR"
chmod 700 "$SSH_DIR"
chmod 700 "$CUSTOM_KEY_DIR"

# ── 2. Generate SSH keys ───────────────────────────────────────────────

# Key A: Passphrase-protected, standard location (tests ASKPASS dialog)
echo "Generating passphrase-protected key in ~/.ssh/id_ed25519..."
ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N "$PASSPHRASE" \
  -C "intent-test-standard@$(hostname)"

# Key B: Passphrase-protected, NON-standard location (tests sshKeyPath setting + tilde expansion)
echo "Generating passphrase-protected key in ~/my-keys/github_key..."
ssh-keygen -t ed25519 -f "$CUSTOM_KEY_DIR/github_key" -N "$PASSPHRASE" \
  -C "intent-test-custom@$(hostname)"

# Key C: No passphrase, standard location (tests normal SSH flow)
echo "Generating no-passphrase key in ~/.ssh/id_rsa..."
ssh-keygen -t rsa -b 4096 -f "$SSH_DIR/id_rsa" -N "" \
  -C "intent-test-nopassphrase@$(hostname)"

# ── 3. Clear ssh-agent (so ASKPASS is triggered) ──────────────────────
echo "Clearing ssh-agent keys..."
ssh-add -D 2>/dev/null || true
# Prevent macOS Keychain from auto-loading keys
if [ -f "$SSH_DIR/config" ]; then
  cp "$SSH_DIR/config" "$SSH_DIR/config.bak"
fi

# ── 4. SSH config with multiple hosts ─────────────────────────────────
cat > "$SSH_DIR/config" <<'EOF'
# Prevent macOS from auto-storing passphrases in Keychain
# (we WANT the passphrase prompt to test ASKPASS)
Host *
  AddKeysToAgent no
  UseKeychain no

# GitHub via standard key (will need passphrase via ASKPASS)
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

# Alias: GitHub via custom-location key (tests sshKeyPath setting)
Host github-custom
  HostName github.com
  User git
  IdentityFile ~/my-keys/github_key
  IdentitiesOnly yes
EOF
chmod 600 "$SSH_DIR/config"

# ── 5. Remove known_hosts (tests StrictHostKeyChecking=accept-new) ────
rm -f "$SSH_DIR/known_hosts"
rm -f "$SSH_DIR/known_hosts.old"
echo "Cleared known_hosts — first SSH connection will trigger host key prompt."

# ── 6. Set up a git worktree test repo ────────────────────────────────
echo ""
echo "Setting up git worktree test repo..."
cd "$WORKTREE_DIR"
git init main-repo
cd main-repo
git commit --allow-empty -m "initial commit"
git branch feature-branch
git worktree add ../worktree-branch feature-branch
echo "Created worktree at: $WORKTREE_DIR/worktree-branch"
echo "  .git is a FILE (not directory) — tests worktree detection"
ls -la "$WORKTREE_DIR/worktree-branch/.git"

# ── 7. Print summary and test instructions ────────────────────────────
echo ""
echo "============================================================"
echo "  SSH Test Environment Ready"
echo "============================================================"
echo ""
echo "  Passphrase for all protected keys: $PASSPHRASE"
echo ""
echo "  Keys created:"
echo "    A) ~/.ssh/id_ed25519          (passphrase, standard loc)"
echo "    B) ~/my-keys/github_key       (passphrase, custom loc)"
echo "    C) ~/.ssh/id_rsa              (no passphrase)"
echo ""
echo "  Public keys to add to GitHub ($GITHUB_USER):"
echo "  ─────────────────────────────────────────────"
echo ""
echo "  Key A (standard):"
cat "$SSH_DIR/id_ed25519.pub"
echo ""
echo "  Key B (custom location):"
cat "$CUSTOM_KEY_DIR/github_key.pub"
echo ""
echo "  Key C (no passphrase):"
cat "$SSH_DIR/id_rsa.pub"
echo ""
echo "  ─────────────────────────────────────────────"
echo "  Add at: https://github.com/settings/ssh/new"
echo ""
echo "  Test scenarios in Intent:"
echo ""
echo "  1. ASKPASS DIALOG: Clone a private repo via SSH."
echo "     → ssh-agent is empty, so Intent should show a native"
echo "       macOS passphrase dialog via SSH_ASKPASS."
echo "     → Enter: $PASSPHRASE"
echo ""
echo "  2. CUSTOM KEY PATH: In Settings > Git > SSH Key Path, enter:"
echo "     ~/my-keys/github_key"
echo "     Then clone a private repo."
echo "     → Tests tilde expansion + custom key + ASKPASS dialog."
echo ""
echo "  3. .PUB FILE PICKER: Click the key icon in SSH Key Path,"
echo "     select ~/my-keys/github_key.pub (the .pub file)."
echo "     → Should auto-strip .pub and use the private key."
echo ""
echo "  4. WORKTREE: Open folder: $WORKTREE_DIR/worktree-branch"
echo "     → Should be recognized as a git repo (not 'Initialize Git here')."
echo ""
echo "  5. HOST KEY: known_hosts is empty, so first SSH connection"
echo "     should auto-accept via StrictHostKeyChecking=accept-new"
echo "     (no interactive prompt blocking the clone)."
echo ""
echo "  6. NO KEY IN ~/.ssh: To test the 'configured key but no"
echo "     default keys' scenario:"
echo "       mv ~/.ssh/id_ed25519* /tmp/"
echo "       mv ~/.ssh/id_rsa* /tmp/"
echo "     Then set SSH Key Path to ~/my-keys/github_key and clone."
echo "     → Should still try SSH (not skip to HTTPS)."
echo "     Restore with: mv /tmp/id_* ~/.ssh/"
echo ""
echo "============================================================"
