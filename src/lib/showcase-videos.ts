// Videos in the homepage video row: only videos artists attach to their own approved designs (no hard-coded list).

export type VideoPlatform = "youtube" | "instagram" | "facebook";

export interface ShowcaseVideo {
  platform: VideoPlatform;
  /** YouTube video id, Instagram reel shortcode, or full Facebook video URL */
  ref: string;
  url: string;
  title: string;
  creator: string;
  creatorUrl?: string;
  ownWork: boolean;
}

export function embedUrl(v: ShowcaseVideo, opts: { autoplay: boolean }): string {
  const ap = opts.autoplay ? 1 : 0;
  switch (v.platform) {
    case "youtube":
      // Privacy-enhanced domain; muted autoplay is the only autoplay browsers allow.
      return `https://www.youtube-nocookie.com/embed/${v.ref}?autoplay=${ap}&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1&enablejsapi=1`;
    case "instagram":
      return `https://www.instagram.com/reel/${v.ref}/embed/`;
    case "facebook":
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(v.ref)}&show_text=false&autoplay=${opts.autoplay}&mute=true&width=360`;
  }
}

export function thumbnailUrl(v: ShowcaseVideo): string | null {
  return v.platform === "youtube" ? `https://i.ytimg.com/vi/${v.ref}/hq2.jpg` : null;
}

export const PLATFORM_LABEL: Record<VideoPlatform, string> = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook" };
