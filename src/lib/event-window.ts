/** The furthest-out opportunity MEET will surface (roughly two calendar months). */
export const UPCOMING_EVENT_WINDOW_DAYS = 62;
export const UPCOMING_EVENT_WINDOW_MS = UPCOMING_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Returns true only for a valid event date strictly after `now` and no more than 62 days away. */
export function isWithinUpcomingEventWindow(value: Date | string, now = new Date()) {
  const eventTime = value instanceof Date ? value.getTime() : new Date(value).getTime();
  const nowTime = now.getTime();
  return Number.isFinite(eventTime) && eventTime > nowTime && eventTime <= nowTime + UPCOMING_EVENT_WINDOW_MS;
}
