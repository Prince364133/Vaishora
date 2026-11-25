/** Extracts the 11-character video id from any common YouTube URL (watch, youtu.be, shorts, embed, live). */
export function youTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    if (host === "youtu.be") return clean(u.pathname.slice(1));
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return clean(u.searchParams.get("v"));
      const m = /^\/(shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      if (m) return clean(m[2]);
    }
  } catch {
    /* not a URL */
  }
  return null;
}

const clean = (v: string | null | undefined) => (v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null);

export const youTubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
