/**
 * Setup Script Types
 *
 * Types for setup scripts that run in worktrees after creation.
 * These scripts handle common tasks like copying .env files, installing deps, etc.
 */

/**
 * Variables available in setup scripts.
 * These are set as environment variables when the script runs.
 */
export interface SetupScriptVariable {
  name: string;
  description: string;
  example: string;
}

export const SETUP_SCRIPT_VARIABLES: SetupScriptVariable[] = [
  {
    name: 'MAIN_CHECKOUT',
    description: 'Absolute path to the main repository checkout (where you cloned the repo)',
    example: '/Users/dev/projects/myrepo',
  },
  {
    name: 'WORKTREE_PATH',
    description: 'Absolute path to the new worktree directory (current working directory)',
    example: '/Users/dev/projects/myrepo-worktrees/feature-branch',
  },
  {
    name: 'BRANCH_NAME',
    description: 'Name of the branch for this worktree',
    example: 'feature/my-feature',
  },
  {
    name: 'SOURCE_BRANCH',
    description: 'Name of the branch this worktree was created from',
    example: 'main',
  },
];

/**
 * Get the variable description for display in tooltips
 */
export function getVariableDescription(varName: string): SetupScriptVariable | undefined {
  return SETUP_SCRIPT_VARIABLES.find((v) => v.name === varName);
}

/**
 * Detect if running on Windows.
 * Works in both main process (process.platform) and renderer (navigator.platform).
 */
const isWindows =
  typeof process !== 'undefined'
    ? process.platform === 'win32'
    : typeof navigator !== 'undefined' && navigator.platform.startsWith('Win');

/**
 * Generate a help comment block for scripts
 */
export function generateVariablesHelpComment(isWindowsOverride?: boolean): string {
  const win = isWindowsOverride ?? isWindows;
  if (win) {
    return `# Available variables:
#   $env:MAIN_CHECKOUT  - Path to main repository checkout
#   $env:WORKTREE_PATH  - Path to this worktree (current directory)
#   $env:BRANCH_NAME    - Name of this worktree's branch
#   $env:SOURCE_BRANCH  - Name of the branch this worktree was created from
`;
  }
  return `# Available variables:
#   $MAIN_CHECKOUT  - Path to main repository checkout
#   $WORKTREE_PATH  - Path to this worktree (current directory)
#   $BRANCH_NAME    - Name of this worktree's branch
#   $SOURCE_BRANCH  - Name of the branch this worktree was created from
`;
}

/**
 * Get the appropriate template content for the current platform.
 * Returns contentWindows on Windows, content otherwise.
 */
export function getTemplateContent(template: SetupScriptTemplate): string {
  if (isWindows && template.contentWindows) {
    return template.contentWindows;
  }
  return template.content;
}

export interface SetupScript {
  id: string;
  name: string;
  content: string;
  repoPath?: string; // Associated repository path (for filtering)
  projectType?: ProjectType;
  lastUsedAt: string;
  usageCount: number;
  createdAt: string;
}

export type ProjectType =
  | 'node-npm'
  | 'node-pnpm'
  | 'node-yarn'
  | 'python-pip'
  | 'python-poetry'
  | 'go'
  | 'rust'
  | 'ruby'
  | 'generic';

export interface SetupScriptTemplate {
  id: string;
  name: string;
  projectType: ProjectType;
  content: string;
  contentWindows?: string;
  description: string;
}

/**
 * Default templates for common project types.
 * These scripts run in the new worktree directory after it's created.
 * Use $MAIN_CHECKOUT to reference the main repo checkout.
 */
export const SETUP_SCRIPT_TEMPLATES: SetupScriptTemplate[] = [
  {
    id: 'node-pnpm',
    name: 'Node.js (pnpm)',
    projectType: 'node-pnpm',
    description: 'Copies .env files from $MAIN_CHECKOUT and installs dependencies with pnpm',
    content: `#!/bin/bash
# Setup script for Node.js project with pnpm
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files from main checkout
for envfile in .env .env.local .env.development .env.development.local; do
  if [ -f "\$MAIN_CHECKOUT/\$envfile" ]; then
    cp "\$MAIN_CHECKOUT/\$envfile" "./\$envfile"
    echo "Copied \$envfile"
  fi
done

# Install dependencies
echo "Installing dependencies..."
pnpm install`,
    contentWindows: `# Setup script for Node.js project with pnpm
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files from main checkout
foreach (\$envfile in @(".env", ".env.local", ".env.development", ".env.development.local")) {
  if (Test-Path "\$env:MAIN_CHECKOUT\\\$envfile") {
    Copy-Item -Path "\$env:MAIN_CHECKOUT\\\$envfile" -Destination ".\\\$envfile"
    Write-Host "Copied \$envfile"
  }
}

# Install dependencies
Write-Host "Installing dependencies..."
pnpm install`,
  },
  {
    id: 'node-npm',
    name: 'Node.js (npm)',
    projectType: 'node-npm',
    description: 'Copies .env files from $MAIN_CHECKOUT and installs dependencies with npm',
    content: `#!/bin/bash
# Setup script for Node.js project with npm
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files from main checkout
for envfile in .env .env.local .env.development .env.development.local; do
  if [ -f "\$MAIN_CHECKOUT/\$envfile" ]; then
    cp "\$MAIN_CHECKOUT/\$envfile" "./\$envfile"
    echo "Copied \$envfile"
  fi
done

# Install dependencies
echo "Installing dependencies..."
npm install`,
    contentWindows: `# Setup script for Node.js project with npm
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files from main checkout
foreach (\$envfile in @(".env", ".env.local", ".env.development", ".env.development.local")) {
  if (Test-Path "\$env:MAIN_CHECKOUT\\\$envfile") {
    Copy-Item -Path "\$env:MAIN_CHECKOUT\\\$envfile" -Destination ".\\\$envfile"
    Write-Host "Copied \$envfile"
  }
}

# Install dependencies
Write-Host "Installing dependencies..."
npm install`,
  },
  {
    id: 'node-yarn',
    name: 'Node.js (yarn)',
    projectType: 'node-yarn',
    description: 'Copies .env files from $MAIN_CHECKOUT and installs dependencies with yarn',
    content: `#!/bin/bash
# Setup script for Node.js project with yarn
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files from main checkout
for envfile in .env .env.local .env.development .env.development.local; do
  if [ -f "\$MAIN_CHECKOUT/\$envfile" ]; then
    cp "\$MAIN_CHECKOUT/\$envfile" "./\$envfile"
    echo "Copied \$envfile"
  fi
done

# Install dependencies
echo "Installing dependencies..."
yarn install`,
    contentWindows: `# Setup script for Node.js project with yarn
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files from main checkout
foreach (\$envfile in @(".env", ".env.local", ".env.development", ".env.development.local")) {
  if (Test-Path "\$env:MAIN_CHECKOUT\\\$envfile") {
    Copy-Item -Path "\$env:MAIN_CHECKOUT\\\$envfile" -Destination ".\\\$envfile"
    Write-Host "Copied \$envfile"
  }
}

# Install dependencies
Write-Host "Installing dependencies..."
yarn install`,
  },
  {
    id: 'python-pip',
    name: 'Python (pip + venv)',
    projectType: 'python-pip',
    description: 'Copies .env from $MAIN_CHECKOUT, creates venv, and installs requirements',
    content: `#!/bin/bash
# Setup script for Python project with pip
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files
if [ -f "\$MAIN_CHECKOUT/.env" ]; then
  cp "\$MAIN_CHECKOUT/.env" "./.env"
  echo "Copied .env"
fi

# Create and activate virtual environment
echo "Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install dependencies
if [ -f "requirements.txt" ]; then
  echo "Installing dependencies..."
  pip install -r requirements.txt
elif [ -f "setup.py" ]; then
  pip install -e .
fi

echo "Virtual environment ready. Activate with: source venv/bin/activate"`,
    contentWindows: `# Setup script for Python project with pip
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files
if (Test-Path "\$env:MAIN_CHECKOUT\\.env") {
  Copy-Item -Path "\$env:MAIN_CHECKOUT\\.env" -Destination ".\\.env"
  Write-Host "Copied .env"
}

# Create and activate virtual environment
Write-Host "Creating virtual environment..."
python -m venv venv
.\\venv\\Scripts\\Activate.ps1

# Install dependencies
if (Test-Path "requirements.txt") {
  Write-Host "Installing dependencies..."
  pip install -r requirements.txt
} elseif (Test-Path "setup.py") {
  pip install -e .
}

Write-Host "Virtual environment ready. Activate with: .\\venv\\Scripts\\Activate.ps1"`,
  },
  {
    id: 'python-poetry',
    name: 'Python (poetry)',
    projectType: 'python-poetry',
    description: 'Copies .env from $MAIN_CHECKOUT and installs dependencies with poetry',
    content: `#!/bin/bash
# Setup script for Python project with poetry
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files
if [ -f "\$MAIN_CHECKOUT/.env" ]; then
  cp "\$MAIN_CHECKOUT/.env" "./.env"
  echo "Copied .env"
fi

# Install dependencies with poetry
echo "Installing dependencies..."
poetry install`,
    contentWindows: `# Setup script for Python project with poetry
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files
if (Test-Path "\$env:MAIN_CHECKOUT\\.env") {
  Copy-Item -Path "\$env:MAIN_CHECKOUT\\.env" -Destination ".\\.env"
  Write-Host "Copied .env"
}

# Install dependencies with poetry
Write-Host "Installing dependencies..."
poetry install`,
  },
  {
    id: 'go',
    name: 'Go',
    projectType: 'go',
    description: 'Copies .env from $MAIN_CHECKOUT and downloads Go module dependencies',
    content: `#!/bin/bash
# Setup script for Go project
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files
if [ -f "\$MAIN_CHECKOUT/.env" ]; then
  cp "\$MAIN_CHECKOUT/.env" "./.env"
  echo "Copied .env"
fi

# Download module dependencies
echo "Downloading Go modules..."
go mod download

echo "Go modules ready"`,
    contentWindows: `# Setup script for Go project
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files
if (Test-Path "\$env:MAIN_CHECKOUT\\.env") {
  Copy-Item -Path "\$env:MAIN_CHECKOUT\\.env" -Destination ".\\.env"
  Write-Host "Copied .env"
}

# Download module dependencies
Write-Host "Downloading Go modules..."
go mod download

Write-Host "Go modules ready"`,
  },
  {
    id: 'rust',
    name: 'Rust (cargo)',
    projectType: 'rust',
    description: 'Copies .env from $MAIN_CHECKOUT and fetches Cargo dependencies',
    content: `#!/bin/bash
# Setup script for Rust project
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment files
if [ -f "\$MAIN_CHECKOUT/.env" ]; then
  cp "\$MAIN_CHECKOUT/.env" "./.env"
  echo "Copied .env"
fi

# Fetch dependencies (faster than full build)
echo "Fetching Cargo dependencies..."
cargo fetch

echo "Dependencies ready. Run 'cargo build' when needed."`,
    contentWindows: `# Setup script for Rust project
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment files
if (Test-Path "\$env:MAIN_CHECKOUT\\.env") {
  Copy-Item -Path "\$env:MAIN_CHECKOUT\\.env" -Destination ".\\.env"
  Write-Host "Copied .env"
}

# Fetch dependencies (faster than full build)
Write-Host "Fetching Cargo dependencies..."
cargo fetch

Write-Host "Dependencies ready. Run 'cargo build' when needed."`,
  },
  {
    id: 'generic',
    name: 'Copy config files only',
    projectType: 'generic',
    description: 'Copies common gitignored config files from $MAIN_CHECKOUT',
    content: `#!/bin/bash
# Generic setup script
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

# Copy environment and config files
for file in .env .env.local .envrc .tool-versions; do
  if [ -f "\$MAIN_CHECKOUT/\$file" ]; then
    cp "\$MAIN_CHECKOUT/\$file" "./\$file"
    echo "Copied \$file"
  fi
done

echo "Config files copied"`,
    contentWindows: `# Generic setup script
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

# Copy environment and config files
foreach (\$file in @(".env", ".env.local", ".envrc", ".tool-versions")) {
  if (Test-Path "\$env:MAIN_CHECKOUT\\\$file") {
    Copy-Item -Path "\$env:MAIN_CHECKOUT\\\$file" -Destination ".\\\$file"
    Write-Host "Copied \$file"
  }
}

Write-Host "Config files copied"`,
  },
  {
    id: 'generic-recursive',
    name: 'Copy config files recursively',
    projectType: 'generic',
    description:
      'Recursively copies .env files from $MAIN_CHECKOUT, skipping node_modules, .git, and gitignored directories',
    content: `#!/bin/bash
# Generic setup script - recursive .env copy
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME, $SOURCE_BRANCH

set -euo pipefail

cd "\$MAIN_CHECKOUT"

# Build find exclusions from .git, node_modules, and gitignored directories
EXCLUDES=(-not -path '*/.git/*' -not -path '*/node_modules/*')
if [ -f .gitignore ]; then
  while IFS= read -r line; do
    # skip comments and blank lines
    [[ -z "\$line" || "\$line" == \\#* ]] && continue
    # strip trailing slashes and whitespace
    dir=\$(echo "\$line" | sed 's:/*$::;s/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "\$dir" ] && [ -d "\$dir" ] && EXCLUDES+=(-not -path "*/\$dir/*")
  done < .gitignore
fi

# Find all .env* files, applying exclusions
find . "\${EXCLUDES[@]}" -name '.env*' -type f | while IFS= read -r file; do
    dir=\$(dirname "\$file")
    mkdir -p "\$WORKTREE_PATH/\$dir"
    cp "\$file" "\$WORKTREE_PATH/\$file"
    echo "Copied \$file"
  done

echo "Done - .env files copied recursively"`,
    contentWindows: `# Generic setup script - recursive .env copy
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME, $env:SOURCE_BRANCH
$ErrorActionPreference = "Stop"

Push-Location \$env:MAIN_CHECKOUT

# Build exclusion list from .git, node_modules, and gitignored directories
\$excludeDirs = @(".git", "node_modules")
if (Test-Path ".gitignore") {
  Get-Content ".gitignore" | ForEach-Object {
    \$line = \$_.Trim()
    # skip comments and blank lines
    if (\$line -and -not \$line.StartsWith("#")) {
      \$dir = \$line.TrimEnd("/", "\\\\")
      if (\$dir -and (Test-Path \$dir -PathType Container)) {
        \$excludeDirs += \$dir
      }
    }
  }
}

# Find all .env* files, skipping excluded directories
Get-ChildItem -Recurse -Filter ".env*" -File | Where-Object {
  \$path = \$_.FullName
  -not (\$excludeDirs | Where-Object { \$path -like "*\\\\\$_\\\\*" })
} | ForEach-Object {
  \$relativePath = \$_.FullName.Substring((Get-Location).Path.Length + 1)
  \$destPath = Join-Path \$env:WORKTREE_PATH \$relativePath
  \$destDir = Split-Path \$destPath -Parent
  if (-not (Test-Path \$destDir)) {
    New-Item -ItemType Directory -Path \$destDir -Force | Out-Null
  }
  Copy-Item -Path \$_.FullName -Destination \$destPath
  Write-Host "Copied \$relativePath"
}

Pop-Location

Write-Host "Done - .env files copied recursively"`,
  },
];
