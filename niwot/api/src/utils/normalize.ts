export function normalizeAnswer(s: string) {
  if (!s) return "";
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase();
}
