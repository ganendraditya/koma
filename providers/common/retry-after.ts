export function parseRetryAfter(header: string | null): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  const seconds = /^-?\d+(?:\.\d+)?$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  if (value.startsWith('-')) return undefined;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}
