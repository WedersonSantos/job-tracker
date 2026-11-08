import { fetchPublicPage } from '../safe-fetch';

/** Reads JSON data, never executes a third-party script. */
export function departmentNames(html: string, id: string): Set<string> {
  const marker = /window\.__appData\s*=\s*/.exec(html);
  if (!marker)
    throw new Error('Ashby: não encontrei os departamentos do mural.');
  const start = marker.index + marker[0].length;
  let depth = 0,
    quoted = false,
    escaped = false,
    end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error('Ashby: dados de departamentos incompletos.');
  const data: unknown = JSON.parse(html.slice(start, end));
  const teams: {
    id: string;
    name: string;
    externalName?: string | null;
    parentTeamId?: string | null;
  }[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (
      item.__typename === 'Team' &&
      typeof item.id === 'string' &&
      typeof item.name === 'string'
    )
      teams.push(item as unknown as (typeof teams)[number]);
    for (const child of Object.values(item)) walk(child);
  };
  walk(data);
  const selected = teams.find((team) => team.id === id);
  if (!selected)
    throw new Error(
      'Ashby: o departamento selecionado não existe neste mural.',
    );
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const team of teams)
      if (
        team.parentTeamId &&
        ids.has(team.parentTeamId) &&
        !ids.has(team.id)
      ) {
        ids.add(team.id);
        changed = true;
      }
  }
  return new Set(
    teams
      .filter((team) => ids.has(team.id))
      .flatMap((team) =>
        [team.name, team.externalName].filter((name): name is string =>
          Boolean(name),
        ),
      ),
  );
}

export async function loadDepartmentNames(slug: string, id: string) {
  const page = await fetchPublicPage(`https://jobs.ashbyhq.com/${slug}`);
  return departmentNames(page.html, id);
}
