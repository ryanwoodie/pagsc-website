// Internal links go through here so they carry the deploy base path.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function href(path: string): string {
  if (/^(https?:|mailto:|tel:|#)/.test(path)) return path;
  return base + path;
}
