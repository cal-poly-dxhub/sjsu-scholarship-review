/**
 * A stored time as a person reads it. Stamps are stored as UTC and shown in the reader's own
 * timezone, so no offset has to be explained on screen. An unreadable stamp is shown as it was
 * stored rather than as "Invalid Date".
 */
export function readableTime(stamp: string): string {
  const at = Date.parse(stamp);
  if (Number.isNaN(at)) return stamp;
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
