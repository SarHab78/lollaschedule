import { uniqueArtists } from "@/lib/lineup";
import { cachedArtists } from "@/lib/enrich";
import { loadManualPicks } from "@/lib/manual";
import { getSessionEmail } from "@/lib/session";
import { mailerEnabled } from "@/lib/mailer";
import PickClient, { PickArtist } from "./PickClient";

export const dynamic = "force-dynamic";

export default async function Pick() {
  const names = uniqueArtists();
  const meta = cachedArtists(names);
  // Sort by whether we have a photo first (nicer grid), then alphabetically.
  const artists: PickArtist[] = names
    .map((name) => ({ name, image: meta.get(name)?.image ?? null }))
    .sort((a, b) => Number(!!b.image) - Number(!!a.image) || a.name.localeCompare(b.name));

  // Returning visitor (cookie or signed-in account)? Re-hydrate saved picks.
  const [saved, accountEmail] = await Promise.all([loadManualPicks(), getSessionEmail()]);
  const lineupSet = new Set(names);
  // Saved names split into ones on the lineup (pre-check in the grid) and
  // off-lineup free-text favorites (pre-fill the textarea).
  const initialSelected = saved.filter((n) => lineupSet.has(n));
  const initialOthers = saved.filter((n) => !lineupSet.has(n));

  return (
    <PickClient
      artists={artists}
      initialSelected={initialSelected}
      initialOthers={initialOthers}
      accountEmail={accountEmail}
      canSignIn={mailerEnabled() && !!process.env.AUTH_SECRET}
    />
  );
}
