// Compact, stateless codec for a set of lineup picks.
//
// Every lineup set id is "set-<n>" with n a contiguous index (0..N-1), so a
// whole schedule is just a set of small integers. We pack the chosen indices
// into a bitset and base64url-encode it — a full day plan fits in ~30 URL-safe
// characters (vs. the old ~175-char "set-26,set-40,..." CSV) with NO server-side
// storage, so /share and the friends compare flow still work with no auth and on
// Vercel's read-only filesystem. Encoding is order- and duplicate-independent.
//
// Pure isomorphic TS (no Buffer/btoa) so the same code runs in the server
// component (/share) and the client component (schedule page).

// URL-safe alphabet: standard base64 with -/_ swapped in for +// so the code
// needs no percent-encoding in a query string.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const REV: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) REV[B64[i]] = i;

/** Parse a "set-<n>" id to its integer index, or null if it doesn't match. */
export function setIndex(id: string): number | null {
  const m = /^set-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Encode a collection of "set-<n>" ids into a compact base64url bitset code. */
export function encodeSets(ids: Iterable<string>): string {
  let max = -1;
  const nums: number[] = [];
  for (const id of ids) {
    const n = setIndex(id);
    if (n !== null) {
      nums.push(n);
      if (n > max) max = n;
    }
  }
  if (max < 0) return "";

  const bytes = new Uint8Array((max >> 3) + 1);
  for (const n of nums) bytes[n >> 3] |= 1 << (n & 7);

  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0b11) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 0b1111) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 0b111111];
  }
  return out;
}

/** Decode a base64url bitset code back into sorted, de-duped "set-<n>" ids. */
export function decodeSets(code: string): string[] {
  const clean = (code ?? "").replace(/[^A-Za-z0-9\-_]/g, "");
  if (!clean) return [];

  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = REV[clean[i]] ?? 0;
    const c1 = REV[clean[i + 1]] ?? 0;
    const c2 = clean[i + 2] !== undefined ? REV[clean[i + 2]] ?? 0 : -1;
    const c3 = clean[i + 3] !== undefined ? REV[clean[i + 3]] ?? 0 : -1;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) bytes.push(((c1 & 0b1111) << 4) | (c2 >> 2));
    if (c3 >= 0) bytes.push(((c2 & 0b11) << 6) | c3);
  }

  const ids: string[] = [];
  for (let b = 0; b < bytes.length; b++) {
    for (let bit = 0; bit < 8; bit++) {
      if (bytes[b] & (1 << bit)) ids.push(`set-${b * 8 + bit}`);
    }
  }
  return ids;
}

/**
 * Pull the LIVE-link slug out of a pasted `/share/<slug>` URL, or null if this
 * isn't a live link. Only the path form is accepted: a bare 12-char string is
 * indistinguishable from a short stateless `?s=` code, so treating one as a slug
 * would misread snapshot links. Callers resolve the slug via /api/share/resolve.
 */
export function parseShareSlug(raw: string): string | null {
  const m = /\/share\/([A-Za-z0-9_-]{12})(?:[/?#]|$)/.exec((raw ?? "").trim());
  return m ? m[1] : null;
}

/**
 * Read the set ids out of anything a user might paste: a full share URL, a bare
 * query string, or just the code. Accepts the new compact `?s=<code>` form AND
 * the legacy `?sets=id1,id2,...` CSV so links shared before this change still
 * resolve. Returns "set-<n>" ids (unfiltered against the current lineup).
 */
export function parseSharePayload(raw: string): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];

  // Try to pull named params out of a URL / query string first.
  const grab = (key: string): string | null => {
    const m = new RegExp(`[?&]${key}=([^&#\\s]+)`).exec(text);
    return m ? m[1] : null;
  };

  const compact = grab("s");
  if (compact) return decodeSets(compact);

  const csv = grab("sets");
  if (csv !== null) {
    let s = csv;
    try {
      s = decodeURIComponent(s);
    } catch {
      /* leave as-is */
    }
    return s.split(",").map((x) => x.trim()).filter(Boolean);
  }

  // No recognizable query param — treat the whole paste as a bare code, unless
  // it already looks like a raw CSV of ids.
  if (/^set-\d+(,set-\d+)*$/.test(text)) {
    return text.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return decodeSets(text);
}
