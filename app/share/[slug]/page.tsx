import type { Metadata } from "next";
import { readShare } from "@/lib/sharelink";
import ShareView from "../ShareView";

// Re-read on every request — that IS the feature. A live link must never be
// served from a cache, or "live" degrades to "stale but confidently labelled".
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { params: Promise<{ slug: string }> };

// LIVE share link: /share/<slug> resolves the slug to its owner's CURRENT picks
// in KV, so a link sent last week reflects edits made since. Auth-free by
// design — holding the unguessable slug is what grants read access.
export default async function LiveShare({ params }: Props) {
  const { slug } = await params;
  const rec = await readShare(slug);

  // Unknown, revoked, or expired. Say so plainly rather than rendering an empty
  // schedule that reads like "this person picked nothing".
  if (!rec) {
    return (
      <main>
        <div className="hero">
          <h1>This link isn&apos;t active</h1>
          <p className="subtitle">
            It may have been turned off by whoever shared it, or it expired. Ask them for a
            fresh link.
          </p>
        </div>
        <a className="btn" href="/schedule" style={{ background: "#26262f" }}>
          Build your own →
        </a>
      </main>
    );
  }

  return <ShareView ids={rec.ids} live updatedAt={rec.updatedAt} />;
}
