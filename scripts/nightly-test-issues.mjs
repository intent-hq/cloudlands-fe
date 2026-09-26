import {
  ISSUE_REPO,
  OWNER,
  SOURCE_REPO,
  failureKey,
  marker,
  occurrenceMarker,
  safeText,
} from './nightly-test-report.mjs';

const CREATED = '<!-- nightly-browser-created:v1 -->';
const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replaceAll('`', '')
    .replace(/\s+/g, ' ');
const issueUrl = (n) => `https://github.com/${ISSUE_REPO}/issues/${n}`;

function matchingIssues(item, inventory) {
  const marked = new Set(
    inventory.comments
      .filter((c) => c.body.includes(marker(item.key)))
      .map((c) => Number(c.issue_url.split('/').at(-1))),
  );
  const exact = inventory.issues.filter(
    (i) => (i.body ?? '').includes(marker(item.key)) || marked.has(i.number),
  );
  if (exact.length) return { candidates: exact, exact: true };
  // A basename/title fragment is not sufficient to adopt a human issue. Require
  // the complete title, spec path, project/suite and failure category/evidence.
  const strong = inventory.issues.filter((i) => {
    const text = fold(`${i.title}\n${i.body ?? ''}`);
    const category =
      item.category === 'assertion'
        ? /expect\(|assertion|toequal|tobe\(/.test(text)
        : item.category === 'timeout'
          ? /timeout|timed out/.test(text)
          : text.includes(fold(item.category)) || text.includes(fold(item.evidence.split('\n')[0]));
    return (
      text.includes(fold(item.file)) &&
      text.includes(fold(item.title)) &&
      text.includes(fold(item.project)) &&
      text.includes(fold(item.suite)) &&
      category
    );
  });
  return { candidates: strong, exact: false };
}

function evidenceBody(
  item,
  run,
  firstSeen,
  candidates = [],
  note = '',
  latestSeen = run.updated_at,
) {
  const runUrl = `https://github.com/${SOURCE_REPO}/actions/runs/${run.id}/attempts/${run.run_attempt}`;
  const artifactLinks = item.artifacts
    .map((name) => `[${safeText(name)}](${runUrl}#artifacts)`)
    .join(', ');
  return (
    `${marker(item.key)}\n${occurrenceMarker(run, item.key)}\n` +
    `Nightly browser ${item.quarantine ? 'quarantine ' : ''}recurrence${item.status === 'flaky' ? ' (passed on retry)' : ''}.\n\n` +
    `First seen: ${firstSeen}. Latest seen: ${latestSeen}.\n` +
    `Commit: [${run.head_sha}](https://github.com/${SOURCE_REPO}/commit/${run.head_sha}). [Run ${run.id}, attempt ${run.run_attempt}](${runUrl}).\n\n` +
    `Suite/project: ${safeText(item.suite)} / ${safeText(item.project)}\n\nSpec: ${safeText(item.file)}\n\nTest: ${safeText(item.title)}\n\nCategory: ${safeText(item.category)}\n\n` +
    `Reports and traces: ${artifactLinks || `[run artifacts](${runUrl}#artifacts)`}.\n\n` +
    `Evidence:\n<pre>${safeText(item.evidence).slice(0, 8000)}</pre>\n\n` +
    (candidates.length
      ? `Possible existing issues need human triage: ${candidates.map((i) => `[${i.number}](${issueUrl(i.number)})`).join(', ')}. No automatic adoption because the match is ambiguous.\n\n`
      : '') +
    note
  );
}

function verifyCreated(issue) {
  if (!(issue.body ?? '').includes(CREATED)) return;
  const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  if (
    issue.type?.name !== 'Bug' ||
    !['component:fe', 'agent-filed'].every((l) => labels.includes(l)) ||
    !issue.assignees?.length
  ) {
    throw new Error(
      `Issue ${issue.number} exists but required Bug type, labels or owner are missing; check token permissions and retry`,
    );
  }
}

export function synchronizeIssues(
  plan,
  client,
  { write = false, checkpoint = () => {}, now = () => new Date().toISOString() } = {},
) {
  const results = [];
  let inventory = { issues: [], comments: [] };
  let since;
  const refresh = () => {
    const started = new Date(new Date(now()).getTime() - 60_000).toISOString();
    const next = client.inventory(since);
    const issues = new Map(inventory.issues.map((i) => [i.number, i]));
    const comments = new Map(inventory.comments.map((c) => [c.id, c]));
    for (const issue of next.issues) issues.set(issue.number, issue);
    for (const comment of next.comments) comments.set(comment.id, comment);
    inventory = { issues: [...issues.values()], comments: [...comments.values()] };
    since = started;
  };
  refresh(); // Includes all states and all pages, including adopted markers in comments.
  const resolveCanonical = (issue) => {
    const seen = new Set();
    while (issue.state === 'closed') {
      if (seen.has(issue.number)) throw new Error('Duplicate issue cycle');
      seen.add(issue.number);
      let canonical = client.canonical(issue.number);
      if (!canonical) {
        const text = [issue.body, ...client.comments(issue.number).map((c) => c.body)].join('\n');
        const refs = [
          ...new Set(
            [
              ...text.matchAll(
                /\bduplicate (?:of|:)\s*(?:https:\/\/github\.com\/intent-hq\/intent\/issues\/|intent-hq\/intent#|#)(\d+)\b/gi,
              ),
            ].map((m) => Number(m[1])),
          ),
        ];
        if (refs.length > 1)
          throw new Error(`Ambiguous duplicate reference on issue ${issue.number}`);
        canonical = refs[0];
      }
      if (!canonical) break;
      issue = client.issue(canonical);
    }
    return issue;
  };
  for (const item of plan.items) {
    if (item.key !== failureKey(item)) throw new Error('Invalid failure identity');
    refresh(); // Serial writer + authoritative recheck immediately before every create.
    const match = matchingIssues(item, inventory);
    let candidates = match.candidates.map((i) => resolveCanonical(client.issue(i.number)));
    candidates = [...new Map(candidates.map((i) => [i.number, i])).values()];
    if (match.exact && candidates.length > 1)
      throw new Error(
        `Conflicting exact failure markers: ${candidates.map((i) => issueUrl(i.number)).join(', ')}`,
      );
    if (item.quarantine) {
      if (item.tracking.length > 1)
        throw new Error(`Ambiguous quarantine tracking for ${item.file}`);
      if (item.tracking.length === 1)
        candidates = [resolveCanonical(client.issue(item.tracking[0]))];
      if (candidates.length !== 1)
        throw new Error(
          `Quarantine failure needs one existing tracking issue: ${item.file} / ${item.title}`,
        );
    }
    let issue = candidates.length === 1 ? candidates[0] : null;
    const result = {
      key: item.key,
      action: issue ? 'update' : 'create',
      issue: issue?.number ?? null,
      candidates: candidates.map((i) => i.number),
      url: issue ? issueUrl(issue.number) : null,
    };
    results.push(result);
    checkpoint(results);
    if (!issue) {
      const body = `${CREATED}\n${evidenceBody(item, plan.run, plan.run.updated_at, candidates)}\nNew-failure triage owner: @${OWNER}.`;
      if (!write) continue;
      issue = client.create(
        `[nightly ${item.suite}] ${item.title}`.replace(/\s+/g, ' ').slice(0, 240),
        body,
      );
      result.issue = issue.number;
      result.url = issueUrl(issue.number);
      checkpoint(results); // Preserve the receipt even if metadata validation fails next.
      verifyCreated(issue);
      inventory.issues.push(issue);
      continue;
    }
    verifyCreated(issue);
    const comments = client.comments(issue.number);
    const seen = occurrenceMarker(plan.run, item.key);
    if ([issue.body, ...comments.map((c) => c.body)].some((s) => s?.includes(seen))) {
      result.action = 'already-recorded';
      checkpoint(results);
      continue;
    }
    const previous = [issue.body, ...comments.map((c) => c.body)].filter((s) =>
      s?.includes(marker(item.key)),
    );
    const sightings = [
      plan.run.updated_at,
      ...previous.flatMap((body) =>
        [...body.matchAll(/(?:First|Latest) seen: ([0-9T:.+-]+Z)\./g)].map((match) => match[1]),
      ),
    ]
      .filter((time) => Number.isFinite(Date.parse(time)))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    const firstSeen = sightings[0];
    const latestSeen = sightings.at(-1);
    const predatesClosure =
      issue.state === 'closed' && Date.parse(plan.run.updated_at) <= Date.parse(issue.closed_at);
    const notPlanned = issue.state === 'closed' && issue.state_reason !== 'completed';
    const owners = (issue.assignees ?? []).map((a) => a.login).filter((s) => /^[\w-]+$/.test(s));
    const note = predatesClosure
      ? 'This delayed completion predates the issue closure; the issue stays closed.\n'
      : notPlanned
        ? `Deliberate closure preserved; recurrence needs owner review: ${(owners.length ? owners : [OWNER]).map((s) => `@${s}`).join(', ')}.\n`
        : '';
    if (issue.state === 'closed' && !notPlanned && !predatesClosure) {
      result.action = 'reopen';
      if (write) client.reopen(issue.number);
    }
    if (notPlanned) result.action = 'closed-recurrence';
    if (predatesClosure) result.action = 'historical-evidence';
    if (write)
      client.comment(issue.number, evidenceBody(item, plan.run, firstSeen, [], note, latestSeen));
    checkpoint(results);
  }
  return results;
}
