import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { getActiveLocale } from '$lib/i18n/locale';

export interface AdvisoryWake {
  refs: string[];
}

/** Only the daemon's explicit advisory flag changes completion wording. */
export function readAdvisoryWake(metadata: unknown): AdvisoryWake | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if (value.childExternallyWaiting !== true) return null;
  const monitors = Array.isArray(value.waitingOnPrMonitors) ? value.waitingOnPrMonitors : [];
  const unique = new Map<string, { repo: string; number: number }>();
  for (const monitor of monitors) {
    if (!monitor || typeof monitor !== 'object' || Array.isArray(monitor)) continue;
    const { repo, prNumber } = monitor as Record<string, unknown>;
    if (
      typeof repo !== 'string' ||
      !repo.trim() ||
      typeof prNumber !== 'number' ||
      !Number.isSafeInteger(prNumber) ||
      prNumber <= 0
    )
      continue;
    const normalizedRepo = repo.trim();
    unique.set(JSON.stringify([normalizedRepo, prNumber]), {
      repo: normalizedRepo,
      number: prNumber,
    });
  }
  const prs = [...unique.values()].sort(
    (a, b) => a.number - b.number || a.repo.localeCompare(b.repo),
  );
  return {
    refs: prs.map((pr) => {
      const ambiguous = prs.some((other) => other.number === pr.number && other.repo !== pr.repo);
      return `${ambiguous ? pr.repo : ''}#${formatInteger(pr.number)}`;
    }),
  };
}

export function advisoryStatusLabel(info: AdvisoryWake): string {
  const { refs } = info;
  if (refs.length === 1) return m.chat_advisoryWake_waitingOnPr_label({ ref: refs[0] });
  if (refs.length === 2)
    return m.chat_advisoryWake_waitingOnPrList_label({
      refs: new Intl.ListFormat(getActiveLocale(), { style: 'long', type: 'conjunction' }).format(
        refs,
      ),
    });
  if (refs.length > 2)
    return m.chat_advisoryWake_waitingOnPrCount_label({ count: formatInteger(refs.length) });
  return m.chat_advisoryWake_waiting_label();
}

export function advisoryActivityLabel(name: string | undefined, info: AdvisoryWake): string {
  const { refs } = info;
  if (!name) return m.chat_advisoryWake_agentWaiting_label({ status: advisoryStatusLabel(info) });
  if (refs.length === 1) return m.chat_advisoryWake_nameWaitingOnPr_label({ name, ref: refs[0] });
  if (refs.length === 2)
    return m.chat_advisoryWake_nameWaitingOnPrList_label({
      name,
      refs: new Intl.ListFormat(getActiveLocale(), { style: 'long', type: 'conjunction' }).format(
        refs,
      ),
    });
  if (refs.length > 2)
    return m.chat_advisoryWake_nameWaitingOnPrCount_label({
      name,
      count: formatInteger(refs.length),
    });
  return m.events_activity_nameIsWaiting_label({ name });
}
