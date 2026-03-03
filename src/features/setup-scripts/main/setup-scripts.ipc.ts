/**
 * Setup Scripts IPC Handlers
 *
 * Handles setup script generation and project type detection.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Logger } from '../../../shared/logger';
import type { ProjectType } from '../types';
import { SETUP_SCRIPT_TEMPLATES, getTemplateContent } from '../types';
import { AugmentCLI } from '../../auggie/main/augment-cli';

const logger = new Logger('SetupScriptsIPC');

interface ProjectAnalysis {
  projectType: ProjectType;
  packageManager?: string;
  gitIgnoredFiles: string[];
  suggestions: string[];
}

/**
 * Detect project type from files in a repository
 */
async function detectProjectType(repoPath: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    projectType: 'generic',
    gitIgnoredFiles: [],
    suggestions: [],
  };

  try {
    const files = await fs.readdir(repoPath);

    // Check for Node.js projects
    if (files.includes('package.json')) {
      const packageJsonPath = path.join(repoPath, 'package.json');
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

        // Detect package manager
        if (files.includes('pnpm-lock.yaml')) {
          analysis.projectType = 'node-pnpm';
          analysis.packageManager = 'pnpm';
        } else if (files.includes('yarn.lock')) {
          analysis.projectType = 'node-yarn';
          analysis.packageManager = 'yarn';
        } else {
          analysis.projectType = 'node-npm';
          analysis.packageManager = 'npm';
        }
      } catch {
        analysis.projectType = 'node-npm';
      }
    }

    // Check for Python projects
    if (files.includes('requirements.txt')) {
      analysis.projectType = 'python-pip';
    } else if (files.includes('pyproject.toml')) {
      const pyprojectPath = path.join(repoPath, 'pyproject.toml');
      try {
        const content = await fs.readFile(pyprojectPath, 'utf-8');
        if (content.includes('[tool.poetry]')) {
          analysis.projectType = 'python-poetry';
        } else {
          analysis.projectType = 'python-pip';
        }
      } catch {
        analysis.projectType = 'python-pip';
      }
    }

    // Check for Go projects
    if (files.includes('go.mod')) {
      analysis.projectType = 'go';
    }

    // Check for Rust projects
    if (files.includes('Cargo.toml')) {
      analysis.projectType = 'rust';
    }

    // Check for Ruby projects
    if (files.includes('Gemfile')) {
      analysis.projectType = 'ruby';
    }

    // Find gitignored files that might need copying
    const commonEnvFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
    for (const envFile of commonEnvFiles) {
      const envPath = path.join(repoPath, envFile);
      try {
        await fs.access(envPath);
        analysis.gitIgnoredFiles.push(envFile);
      } catch {
        // File doesn't exist
      }
    }

    // Add suggestions based on analysis
    if (analysis.gitIgnoredFiles.length > 0) {
      analysis.suggestions.push(
        `Copy ${analysis.gitIgnoredFiles.join(', ')} from parent directory`,
      );
    }
    if (analysis.packageManager) {
      analysis.suggestions.push(`Install dependencies with ${analysis.packageManager}`);
    }
  } catch (error) {
    logger.error('Failed to analyze project', error as Error);
  }

  return analysis;
}

/**
 * Generate a setup script based on project analysis.
 * Uses the matching template content which references $MAIN_CHECKOUT for env file copying.
 */
function generateScript(analysis: ProjectAnalysis): string {
  // Find matching template, fall back to generic
  const template =
    SETUP_SCRIPT_TEMPLATES.find((t) => t.projectType === analysis.projectType) ??
    SETUP_SCRIPT_TEMPLATES.find((t) => t.projectType === 'generic');

  if (template) {
    return getTemplateContent(template);
  }

  return '';
}

export function registerSetupScriptsHandlers(): void {
  // Generate setup script for a repository
  ipcMain.handle('setup-scripts:generate', async (_event, { repoPath }: { repoPath: string }) => {
    try {
      logger.info('Generating setup script', { repoPath });

      const analysis = await detectProjectType(repoPath);
      const script = generateScript(analysis);

      logger.info('Setup script generated', {
        repoPath,
        projectType: analysis.projectType,
        envFilesFound: analysis.gitIgnoredFiles.length,
      });

      return {
        success: true,
        data: {
          script,
          projectType: analysis.projectType,
          analysis,
        },
      };
    } catch (error) {
      logger.error('Failed to generate setup script', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Detect project type only (without generating script)
  ipcMain.handle(
    'setup-scripts:detect-type',
    async (_event, { repoPath }: { repoPath: string }) => {
      try {
        const analysis = await detectProjectType(repoPath);
        return { success: true, data: analysis };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Active agent streams for cleanup
  const activeStreams = new Map<string, AbortController>();

  // Generate setup script using an AI agent with streaming
  ipcMain.handle(
    'setup-scripts:generate-with-agent',
    async (event, { repoPath, agentId }: { repoPath: string; agentId: string }) => {
      try {
        logger.info('Starting agent-based setup script generation', { repoPath, agentId });

        const streamId = agentId;
        const abortController = new AbortController();
        activeStreams.set(streamId, abortController);

        // Get the instruction for setup script generation (platform-aware)
        const SETUP_SCRIPT_INSTRUCTION = process.platform === 'win32'
          ? `# Setup Script Generator

You are a specialized agent that analyzes a repository and generates a PowerShell setup script that will run after a git worktree is created.

## Your Task

Analyze the repository structure and generate a comprehensive setup script that:
1. Copies any necessary config files (.env, .env.local, etc.) from the main checkout
2. Installs dependencies using the correct package manager
3. Sets up any required development environment
4. Handles any project-specific initialization

## Available Environment Variables

The following environment variables are available in your script:

- \`$env:MAIN_CHECKOUT\` - Absolute path to the main repository checkout (where the user cloned the repo)
- \`$env:WORKTREE_PATH\` - Absolute path to the new worktree directory (also the current working directory)
- \`$env:BRANCH_NAME\` - Name of the branch for this worktree

**Use these variables instead of relative paths like \`..\`** - they are more reliable and explicit.

## Analysis Steps

1. **Detect Project Type**: Look at package.json, requirements.txt, Cargo.toml, go.mod, Gemfile, etc.
2. **Detect Package Manager**: pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm
3. **Find Config Files**: Look for .env*, config files that might be gitignored and need copying
4. **Check Build Requirements**: Look for build scripts, Makefiles, etc.

## Script Requirements

- This is a PowerShell script (no shebang needed)
- Add a comment listing available variables: \`# Available: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME\`
- Include helpful comments explaining each section
- Use \`$ErrorActionPreference = "Stop"\` to exit on errors (optional, include if appropriate)
- Handle missing files gracefully with \`-ErrorAction SilentlyContinue\`
- Be idempotent - safe to run multiple times

## Output Format

You MUST output the script using the \`<setup_script>\` XML tag with these attributes:
- \`name\`: A short descriptive name for the script (e.g., "Node.js + pnpm setup")
- \`description\`: A one-line description that mentions $env:MAIN_CHECKOUT when referencing the source

Example:
<setup_script name="Node.js + pnpm setup" description="Copies .env from $env:MAIN_CHECKOUT and installs dependencies with pnpm">
# Available variables: $env:MAIN_CHECKOUT, $env:WORKTREE_PATH, $env:BRANCH_NAME

# Copy environment files from main checkout
Copy-Item -Path "$env:MAIN_CHECKOUT\\.env" -Destination ".env" -ErrorAction SilentlyContinue
Copy-Item -Path "$env:MAIN_CHECKOUT\\.env.local" -Destination ".env.local" -ErrorAction SilentlyContinue

# Install dependencies
pnpm install
</setup_script>

## Important Notes

- The script runs in the NEW worktree directory, NOT the original repo
- Use \`$env:MAIN_CHECKOUT\` to reference files in the original checkout (preferred over \`..\`)
- Keep scripts focused and fast - they run before work begins
- Don't include steps that take too long (e.g., full builds)
- Dependencies should be installed but not necessarily built

Now analyze the repository and generate an appropriate setup script.`
          : `# Setup Script Generator

You are a specialized agent that analyzes a repository and generates a bash setup script that will run after a git worktree is created.

## Your Task

Analyze the repository structure and generate a comprehensive setup script that:
1. Copies any necessary config files (.env, .env.local, etc.) from the main checkout
2. Installs dependencies using the correct package manager
3. Sets up any required development environment
4. Handles any project-specific initialization

## Available Environment Variables

The following environment variables are available in your script:

- \`$MAIN_CHECKOUT\` - Absolute path to the main repository checkout (where the user cloned the repo)
- \`$WORKTREE_PATH\` - Absolute path to the new worktree directory (also the current working directory)
- \`$BRANCH_NAME\` - Name of the branch for this worktree

**Use these variables instead of relative paths like \`..\`** - they are more reliable and explicit.

## Analysis Steps

1. **Detect Project Type**: Look at package.json, requirements.txt, Cargo.toml, go.mod, Gemfile, etc.
2. **Detect Package Manager**: pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm
3. **Find Config Files**: Look for .env*, config files that might be gitignored and need copying
4. **Check Build Requirements**: Look for build scripts, Makefiles, etc.

## Script Requirements

- Start with a shebang: \`#!/bin/bash\`
- Add a comment listing available variables: \`# Available: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME\`
- Include helpful comments explaining each section
- Use \`set -e\` to exit on errors (optional, include if appropriate)
- Handle missing files gracefully with \`|| true\` or \`2>/dev/null\`
- Be idempotent - safe to run multiple times

## Output Format

You MUST output the script using the \`<setup_script>\` XML tag with these attributes:
- \`name\`: A short descriptive name for the script (e.g., "Node.js + pnpm setup")
- \`description\`: A one-line description that mentions $MAIN_CHECKOUT when referencing the source

Example:
<setup_script name="Node.js + pnpm setup" description="Copies .env from $MAIN_CHECKOUT and installs dependencies with pnpm">
#!/bin/bash
# Available variables: $MAIN_CHECKOUT, $WORKTREE_PATH, $BRANCH_NAME

# Copy environment files from main checkout
cp "$MAIN_CHECKOUT/.env" .env 2>/dev/null || true
cp "$MAIN_CHECKOUT/.env.local" .env.local 2>/dev/null || true

# Install dependencies
pnpm install
</setup_script>

## Important Notes

- The script runs in the NEW worktree directory, NOT the original repo
- Use \`$MAIN_CHECKOUT\` to reference files in the original checkout (preferred over \`..\`)
- Keep scripts focused and fast - they run before work begins
- Don't include steps that take too long (e.g., full builds)
- Dependencies should be installed but not necessarily built

Now analyze the repository and generate an appropriate setup script.`;

        // Get project analysis for context
        const analysis = await detectProjectType(repoPath);
        const contextMessage = `Please analyze this repository and generate a setup script.

Repository path: ${repoPath}
Detected project type: ${analysis.projectType}
Package manager: ${analysis.packageManager || 'unknown'}
Environment files found: ${analysis.gitIgnoredFiles.join(', ') || 'none'}

Please look at the repository structure and generate an appropriate setup script.`;

        // Use AugmentCLI for streaming
        const cli = new AugmentCLI();
        const window = BrowserWindow.fromWebContents(event.sender);

        // Stream the response - workspacePath is used as cwd for the CLI process
        // Skip MCP servers - setup script generation doesn't need external tools
        const context = {
          systemPrompt: SETUP_SCRIPT_INSTRUCTION,
          workspacePath: repoPath,
          skipMcp: true,
        };
        cli
          .streamChat(
            contextMessage,
            context as any,
            (chunk: string) => {
              // Send chunk to renderer
              if (window && !window.isDestroyed()) {
                window.webContents.send('setup-scripts:stream-chunk', {
                  streamId,
                  chunk,
                });
              }
            },
            abortController.signal,
          )
          .then(() => {
            // Send completion
            if (window && !window.isDestroyed()) {
              window.webContents.send('setup-scripts:stream-complete', { streamId });
            }
            activeStreams.delete(streamId);
          })
          .catch((error) => {
            // Send error
            if (window && !window.isDestroyed()) {
              window.webContents.send('setup-scripts:stream-error', {
                streamId,
                error: error.message,
              });
            }
            activeStreams.delete(streamId);
          });

        return { success: true, streamId };
      } catch (error) {
        logger.error('Failed to start agent-based setup script generation', error as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  );

  // Stop agent generation
  ipcMain.handle('setup-scripts:stop-agent', async (_event, { agentId }: { agentId: string }) => {
    const controller = activeStreams.get(agentId);
    if (controller) {
      controller.abort();
      activeStreams.delete(agentId);
      logger.info('Stopped agent-based setup script generation', { agentId });
    }
    return { success: true };
  });

  logger.info('Setup scripts IPC handlers registered');
}
