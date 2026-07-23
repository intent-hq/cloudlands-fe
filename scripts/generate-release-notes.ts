#!/usr/bin/env tsx
/**
 * Generate Release Notes
 *
 * This script generates clean, user-friendly release notes using Auggie.
 * It analyzes recent commits and produces bullet points of improvements
 * without exposing internal commit history.
 *
 * Usage:
 *   tsx scripts/generate-release-notes.ts
 *
 * Output:
 *   dist-electron/release-notes.json
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = 'dist-electron';
const OUTPUT_FILE = path.join(DIST_DIR, 'release-notes.json');

interface ReleaseNotes {
  version: string;
  date: string;
  highlights: string[];
}

function getCurrentVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function getRecentCommitMessages(): string[] {
  try {
    // Get commit messages from the last 50 commits or since last version bump
    const result = execSync('git log --oneline -50 --format="%s"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function generateReleaseNotes(commitMessages: string[]): string[] {
  console.log('🤖 Generating release notes with Auggie...');

  const commitList = commitMessages.slice(0, 30).join('\n');

  const instruction = `You are writing release notes for an app update. Based on these git commit messages, generate 3-6 concise bullet points describing the improvements and new features.

Rules:
- Write for end users, not developers
- Focus on benefits and improvements they'll notice
- Skip internal/technical changes, refactors, and fixes they won't see
- Each bullet should be 1 short sentence
- Don't mention commit hashes, file names, or technical jargon
- If there's nothing user-facing, write "Bug fixes and performance improvements"

Output ONLY the bullet points, one per line, starting with "- ". No intro text.

Commits:
${commitList}`;

  try {
    // Pass the instruction as an argument (no shell) so commit-message content
    // is never interpreted by a shell
    const result = execFileSync('auggie', ['--print', '-i', instruction], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000, // 2 minute timeout
    }).trim();

    // Parse bullet points from the output
    const lines = result
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-') || line.startsWith('•'))
      .map((line) => line.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 8); // Max 8 bullet points

    if (lines.length > 0) {
      return lines;
    }

    // If parsing failed, return the whole thing as one item
    return ['Bug fixes and performance improvements'];
  } catch (error) {
    console.log('⚠️  Auggie generation failed, using fallback');
    return ['Bug fixes and performance improvements'];
  }
}

async function main() {
  console.log('📝 Generating release notes...\n');

  const version = getCurrentVersion();
  console.log(`📦 Current version: ${version}`);

  const commitMessages = getRecentCommitMessages();
  console.log(`📋 Found ${commitMessages.length} recent commits\n`);

  const highlights = generateReleaseNotes(commitMessages);

  console.log('\n📋 Generated highlights:');
  highlights.forEach((h) => console.log(`   • ${h}`));

  const releaseNotes: ReleaseNotes = {
    version,
    date: new Date().toISOString(),
    highlights,
  };

  // Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(releaseNotes, null, 2));
  console.log(`\n✅ Release notes saved to ${OUTPUT_FILE}`);
}

main().catch(console.error);
