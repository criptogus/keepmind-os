/** Accent-insensitive, all-word matching; exact and title matches rank first. */
export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
export function searchRank(query: string, title: string, context = ''): number {
  const term = normalizeSearch(query), name = normalizeSearch(title), text = `${name} ${normalizeSearch(context)}`;
  if (!term) return 1;
  if (!term.split(/\s+/).every(word => text.includes(word))) return 0;
  return name === term ? 5 : name.startsWith(term) ? 4 : term.split(/\s+/).every(word => name.includes(word)) ? 3 : 2;
}
