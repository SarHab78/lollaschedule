import { uniqueArtists } from "@/lib/lineup";
import { cachedArtists } from "@/lib/enrich";
import PickClient, { PickArtist } from "./PickClient";

export const dynamic = "force-dynamic";

export default function Pick() {
  const names = uniqueArtists();
  const meta = cachedArtists(names);
  // Sort by whether we have a photo first (nicer grid), then alphabetically.
  const artists: PickArtist[] = names
    .map((name) => ({ name, image: meta.get(name)?.image ?? null }))
    .sort((a, b) => Number(!!b.image) - Number(!!a.image) || a.name.localeCompare(b.name));

  return <PickClient artists={artists} />;
}
