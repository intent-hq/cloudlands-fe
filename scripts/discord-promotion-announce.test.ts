// @verify-changed-triggers: .github/workflows/announce-promotion.yml, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  announcementMessage,
  channelReleaseUrl,
  isDiscordWebhookUrl,
  webhookPayload,
} from './discord-promotion-announce.mjs';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = updaterRequire('js-yaml');

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  'runs-on'?: string;
  if?: string;
  permissions?: Record<string, string>;
  steps?: Step[];
}

describe('Discord promotion announcement', () => {
  it('links each channel to its rolling release notes', () => {
    expect(channelReleaseUrl('beta')).toBe(
      'https://github.com/intent-hq/cloudlands-releases/releases/tag/beta',
    );
    expect(channelReleaseUrl('stable')).toBe(
      'https://github.com/intent-hq/cloudlands-releases/releases/tag/stable',
    );
    expect(() => channelReleaseUrl('alpha')).toThrow(/beta, stable/);
  });

  it('announces a stable promotion with the version and its release notes', () => {
    const message = announcementMessage('stable', '2.310.5');
    expect(message).toContain('**Intent v2.310.5 is now on the Stable channel**');
    expect(message).toContain('<https://intentapp.dev>');
    expect(message).toContain(
      '<https://github.com/intent-hq/cloudlands-releases/releases/tag/stable>',
    );
    expect(message).not.toMatch(/Update channel/);
  });

  it('announces a beta promotion and says how to switch to beta', () => {
    const message = announcementMessage('beta', '2.341.1');
    expect(message).toContain('**Intent v2.341.1 is now on the Beta channel**');
    expect(message).toContain('Settings → General → Updates → Update channel');
    expect(message).toContain(
      '<https://github.com/intent-hq/cloudlands-releases/releases/tag/beta>',
    );
  });

  it('wraps every link in <> so Discord shows no preview cards', () => {
    for (const channel of ['beta', 'stable']) {
      const message = announcementMessage(channel, '1.2.3');
      const bare = message.replace(/<https:\/\/[^>\s]+>/g, '');
      expect(bare).not.toMatch(/https?:\/\//);
    }
  });

  it('rejects versions that are not plain release versions', () => {
    expect(() => announcementMessage('stable', '2.310.5-rc.1')).toThrow(/version/);
    expect(() => announcementMessage('stable', '@everyone')).toThrow(/version/);
  });

  it('builds a webhook payload that can never ping anyone', () => {
    const payload = webhookPayload('stable', '2.310.5');
    expect(payload.content).toBe(announcementMessage('stable', '2.310.5'));
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content.length).toBeLessThanOrEqual(2000);
  });

  it('accepts only Discord webhook URLs', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc-DEF_9')).toBe(true);
    expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/123/abc')).toBe(true);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://example.com/api/webhooks/123/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.test/api/webhooks/1/a')).toBe(false);
    expect(isDiscordWebhookUrl('')).toBe(false);
  });
});

describe('announce-promotion.yml', () => {
  const file = '.github/workflows/announce-promotion.yml';
  const workflow = load(readFileSync(file, 'utf8'));
  const workflowName = (name: string) =>
    load(readFileSync(`.github/workflows/${name}.yml`, 'utf8')).name;
  const job = (workflow.jobs as Record<string, Job>).announce;
  const steps = job?.steps ?? [];

  it('runs after Promote Beta and Release Stable only, never after alpha releases', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: [workflowName('promote-beta'), workflowName('release-stable')],
      types: ['completed'],
    });
    expect(JSON.stringify(workflow.on)).not.toContain('Release Alpha');
  });

  it('posts only after a successful promotion, or a manual dispatch', () => {
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs.channel).toMatchObject({ type: 'choice', options: ['beta', 'stable'] });
    expect(inputs.dry_run).toMatchObject({ type: 'boolean', default: true });
  });

  it('maps each promotion workflow to its channel', () => {
    const resolve = steps.find((s) => s.run?.includes('CHANNEL='));
    expect(resolve?.run).toContain('"Promote Beta" ]; then CHANNEL=beta');
    expect(resolve?.run).toContain('"Release Stable" ]; then CHANNEL=stable');
  });

  it('reads no repository write access and checks out only the scripts it runs', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toBeUndefined();
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.workflow_sha }}');
    expect(String(checkout?.with?.['persist-credentials'])).toBe('false');
    for (const script of [
      'scripts/discord-promotion-announce.mjs',
      'scripts/intent-web-dist-tag-sync.mjs',
      'scripts/intent-web-publish-plan.mjs',
    ])
      expect(checkout?.with?.['sparse-checkout']).toContain(script);
  });

  it('passes the webhook only through the environment of the posting step', () => {
    const post = steps.find((s) => s.run?.includes('scripts/discord-promotion-announce.mjs'));
    expect(post?.env?.DISCORD_ANNOUNCEMENTS_WEBHOOK).toBe(
      '${{ secrets.DISCORD_ANNOUNCEMENTS_WEBHOOK }}',
    );
    expect(post?.run).not.toContain('secrets.');
    // Only a hand-started run can be a dry run; promotions always post.
    expect(post?.env?.DRY_RUN).toBe(
      "${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}",
    );
    const others = steps.filter((s) => s !== post);
    for (const step of others) expect(JSON.stringify(step)).not.toContain('secrets.');
  });
});
