# Remote Environment Test Server
# Configurable Docker image for testing SSH-based remote development

FROM ubuntu:22.04

# Build arguments for profile customization
ARG SSH_PORT=22
ARG SSH_USER=testuser
ARG INSTALL_NODEJS=true
ARG INSTALL_PYTHON=true
ARG MINIMAL_INSTALL=false

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV SSH_PORT=${SSH_PORT}
ENV SSH_USER=${SSH_USER}

# Install base packages
RUN apt-get update && apt-get install -y \
    openssh-server \
    git \
    curl \
    sudo \
    locales \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install additional tools unless minimal
RUN if [ "$MINIMAL_INSTALL" = "false" ]; then \
    apt-get update && apt-get install -y \
    wget vim nano htop tree jq build-essential bash-completion \
    && rm -rf /var/lib/apt/lists/*; \
    fi

# Install Node.js if requested
RUN if [ "$INSTALL_NODEJS" = "true" ]; then \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @augmentcode/auggie; \
    fi

# Install Python if requested
RUN if [ "$INSTALL_PYTHON" = "true" ]; then \
    apt-get update && apt-get install -y python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*; \
    fi

# Set up locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Create configurable user
RUN useradd -m -s /bin/bash -G sudo ${SSH_USER} \
    && echo "${SSH_USER}:${SSH_USER}" | chpasswd \
    && echo "${SSH_USER} ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set up SSH directory
RUN mkdir /var/run/sshd

# Configure basic SSH settings (port will be set at runtime)
RUN sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Set up user directories
RUN mkdir -p /home/${SSH_USER}/.config/pod-init.d \
    && mkdir -p /home/${SSH_USER}/.ssh \
    && mkdir -p /home/${SSH_USER}/repos \
    && chmod 700 /home/${SSH_USER}/.ssh \
    && touch /home/${SSH_USER}/.ssh/authorized_keys \
    && chmod 600 /home/${SSH_USER}/.ssh/authorized_keys \
    && chown -R ${SSH_USER}:${SSH_USER} /home/${SSH_USER}

# Set up git config for user
RUN su - ${SSH_USER} -c "git config --global user.name 'Test User'" \
    && su - ${SSH_USER} -c "git config --global user.email 'test@remote.local'" \
    && su - ${SSH_USER} -c "git config --global init.defaultBranch main"

# Create test repository (as the user so git config is available)
RUN su - ${SSH_USER} -c "cd ~/repos && git init test-repo && cd test-repo && echo '# Test Repository' > README.md && echo 'Created for remote environment testing' >> README.md && git add README.md && git commit -m 'Initial commit'"

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE ${SSH_PORT}
WORKDIR /home/${SSH_USER}

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/sbin/sshd", "-D"]
