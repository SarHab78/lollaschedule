import type { Metadata } from "next";
import { decodeSets } from "@/lib/setcode";
import ShareView from "./ShareView";

export const dynamic = "force-dynamic";

// Someone else's schedule is not ours to put in a search index. The live
// /share/<slug> route sets the same header.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ s?: string; sets?: string }> };

// Public, read-only STATIC snapshot of a schedule encoded as ?s=<compact code>
// (or the legacy ?sets=id1,id2,... CSV). Frozen at the moment it was copied —
// live links that follow the owner's edits live at /share/<slug> instead. Both
// forms stay supported, so every link ever shared keeps working.
export default async function Share({ searchParams }: Props) {
  const { s, sets } = await searchParams;
  const ids = s ? decodeSets(s) : (sets ?? "").split(",").filter(Boolean);
  return <ShareView ids={ids} />;
}
