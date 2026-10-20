/** Unwrap a database list read. Throws on failure so a failed load is reported, never shown as "nothing yet". */
export function rows<T>(r: { data: T[] | null; error: unknown }): T[] {
  if (r.error) throw r.error;
  return r.data ?? [];
}
