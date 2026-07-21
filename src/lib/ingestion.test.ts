import { describe, expect, it } from "vitest";
import { defaultProfile } from "./demo-data";
import { parseIcs, parseRss } from "./ingestion";

const now = new Date("2026-07-21T12:00:00Z");
const sourceUrl = "https://calendar.example.edu/events.ics";

describe("structured feed event window", () => {
  it("keeps only RSS entries in the upcoming 62-day window", () => {
    const inWindow = new Date(now.getTime() + 62 * 86_400_000).toUTCString();
    const tooFar = new Date(now.getTime() + 63 * 86_400_000).toUTCString();
    const past = new Date(now.getTime() - 86_400_000).toUTCString();
    const rss = `<rss><channel>
      <item><title>In window</title><pubDate>${inWindow}</pubDate><link>https://example.edu/in-window</link></item>
      <item><title>Too far</title><pubDate>${tooFar}</pubDate><link>https://example.edu/too-far</link></item>
      <item><title>Past</title><pubDate>${past}</pubDate><link>https://example.edu/past</link></item>
    </channel></rss>`;

    expect(parseRss(rss, sourceUrl, now).map((event) => event.title)).toEqual(["In window"]);
  });

  it("keeps only ICS events in the upcoming 62-day window", () => {
    const icsDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const inWindow = icsDate(new Date(now.getTime() + 62 * 86_400_000));
    const tooFar = icsDate(new Date(now.getTime() + 63 * 86_400_000));
    const past = icsDate(new Date(now.getTime() - 86_400_000));
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:In window
DTSTART:${inWindow}
URL:https://example.edu/in-window
END:VEVENT
BEGIN:VEVENT
SUMMARY:Too far
DTSTART:${tooFar}
URL:https://example.edu/too-far
END:VEVENT
BEGIN:VEVENT
SUMMARY:Past
DTSTART:${past}
URL:https://example.edu/past
END:VEVENT
END:VCALENDAR`;

    expect(parseIcs(ics, sourceUrl, now).map((event) => event.title)).toEqual(["In window"]);
  });

  it("keeps physical RSS and ICS events only when verified inside the travel area", () => {
    const profile = { ...defaultProfile, travelRadius: 5 };
    const rss = `<rss><channel><item><title>Nearby RSS event</title><pubDate>${new Date(now.getTime() + 2 * 86_400_000).toUTCString()}</pubDate><geo:lat>41.88</geo:lat><geo:long>-87.63</geo:long></item><item><title>Far RSS event</title><pubDate>${new Date(now.getTime() + 3 * 86_400_000).toUTCString()}</pubDate><geo:lat>42.3314</geo:lat><geo:long>-83.0458</geo:long></item></channel></rss>`;
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Nearby ICS event
DTSTART:20260723T090000Z
GEO:41.88;-87.63
END:VEVENT
BEGIN:VEVENT
SUMMARY:Far ICS event
DTSTART:20260724T090000Z
GEO:42.3314;-83.0458
END:VEVENT
END:VCALENDAR`;

    const parsedIcs = parseIcs(ics, sourceUrl, now);
    expect(parsedIcs).toHaveLength(2);
    expect(parsedIcs[0]).toMatchObject({ latitude: 41.88, longitude: -87.63 });
    expect(parseRss(rss, sourceUrl, now, profile).map((event) => event.title)).toEqual(["Nearby RSS event"]);
    expect(parseIcs(ics, sourceUrl, now, profile).map((event) => event.title)).toEqual(["Nearby ICS event"]);
  });
});
