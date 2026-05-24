/** True if the value looks like a URL template, not a real link. */
function isUrlTemplate(value: string): boolean {
  return /[{<][^}>]*[}>]/.test(value);
}

/**
 * Normalize a string into an absolute http(s) href, or null if not linkable.
 */
export function resolveHref(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  if (isUrlTemplate(v)) return null;

  if (/^https?:\/\//i.test(v)) return v;

  if (/^www\./i.test(v)) return `https://${v}`;

  if (/^github\.com\//i.test(v)) return `https://${v}`;

  if (/^[\w.-]+\.[\w.-]+(\/.*)?$/i.test(v) && !v.includes(' ')) {
    return `https://${v}`;
  }

  return null;
}

export function isClickableUrl(value: string | null | undefined): boolean {
  return resolveHref(value) !== null;
}
