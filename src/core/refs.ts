/**
 * Secret references look like `{{keymark:aws/prod/token}}`.
 * The model writes references; KeyMark replaces them with values
 * only inside the child process it spawns.
 */
export const REF_RE = /\{\{\s*keymark:([A-Za-z0-9][A-Za-z0-9._/-]*)\s*\}\}/g;

export function findRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(REF_RE)) out.add(m[1]);
  return [...out];
}

export function collectRefs(texts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const r of findRefs(t)) out.add(r);
  return [...out];
}

export function hasRefs(text: string): boolean {
  REF_RE.lastIndex = 0;
  return REF_RE.test(text);
}

/** Replaces every reference with its value. Unknown references throw. */
export function resolveRefs(text: string, values: Map<string, string>): string {
  return text.replace(REF_RE, (_m, path: string) => {
    const v = values.get(path);
    if (v === undefined) throw new Error(`Unresolved secret reference: ${path}`);
    return v;
  });
}

/** Display form used in logs and scrubbed output. */
export function placeholder(path: string): string {
  return `[keymark:${path}]`;
}
