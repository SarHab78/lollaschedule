// Generate an iCalendar (.ics) feed from a set of performances. Lolla runs in
// Chicago in early August = Central Daylight Time (UTC-5), so we convert the
// local wall-clock times to UTC and emit unambiguous Z-stamped timestamps.

export type IcsSet = {
  id: string;
  artist: string;
  stage: string;
  start: string; // "2026-07-30T16:30" (local CDT)
  end: string;
};

const CDT_OFFSET_HOURS = 5; // Central Daylight Time is UTC-5

function toUtcStamp(localIso: string): string {
  const [date, time] = localIso.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Shift local CDT to UTC; Date.UTC handles day/month rollover (e.g. 10pm+5h).
  const utc = new Date(Date.UTC(y, mo - 1, d, h + CDT_OFFSET_HOURS, mi));
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${utc.getUTCFullYear()}${p(utc.getUTCMonth() + 1)}${p(utc.getUTCDate())}` +
    `T${p(utc.getUTCHours())}${p(utc.getUTCMinutes())}00Z`
  );
}

export function buildIcs(sets: IcsSet[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LollaSchedule//Lollapalooza 2026//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Lollapalooza 2026",
  ];
  for (const s of sets) {
    const stamp = toUtcStamp(s.start);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${s.id}@lollaschedule`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${stamp}`,
      `DTEND:${toUtcStamp(s.end)}`,
      `SUMMARY:${escapeText(`${s.artist} — ${s.stage}`)}`,
      `LOCATION:${escapeText(`${s.stage} Stage, Grant Park, Chicago`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function escapeText(t: string): string {
  return t.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}
