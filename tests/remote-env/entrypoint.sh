#!/bin/bash
# Entrypoint for remote environment test server

set -e

SSH_USER=${SSH_USER:-testuser}
SSH_PORT=${SSH_PORT:-22}

echo "=== Remote Environment Test Server ==="
echo "User: ${SSH_USER}"
echo "Port: ${SSH_PORT}"
echo ""

# Configure SSH port at runtime
echo "Configuring SSH on port ${SSH_PORT}..."
sed -i "s/^#Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
sed -i "s/^Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config
# If no Port line exists, add one
grep -q "^Port " /etc/ssh/sshd_config || echo "Port ${SSH_PORT}" >> /etc/ssh/sshd_config

# Run pod-init.d scripts if they exist (simulates DevPod behavior)
INIT_DIR="/home/${SSH_USER}/.config/pod-init.d"
if [ -d "$INIT_DIR" ]; then
    echo "Running pod-init.d scripts..."
    for script in "$INIT_DIR"/*.sh; do
        if [ -f "$script" ] && [ -x "$script" ]; then
            echo "  Running: $(basename $script)"
            su - ${SSH_USER} -c "$script" || echo "  Warning: $script failed"
        fi
    done
    echo "pod-init.d scripts complete"
fi

# Generate SSH host keys if they don't exist
if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    echo "Generating SSH host keys..."
    ssh-keygen -A
fi

echo ""
echo "SSH server starting on port ${SSH_PORT}..."
echo "Connect with: ssh -p ${SSH_PORT} ${SSH_USER}@localhost"
echo ""

# Execute the command (sshd)
exec "$@"
