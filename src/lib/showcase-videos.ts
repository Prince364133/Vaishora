// Mehndi videos shown in the "Real mehndi, real hands" row on the homepage.
// These are embedded with each platform's official player and remain the property of their
// creators; they are credited on every card and must NOT be presented as VAISHORA customer work
// or VAISHORA reviews unless that is true. Replace with VAISHORA's own customer videos (with
// consent) as soon as they exist — set `ownWork: true` for those.

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

export const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    platform: "youtube",
    ref: "z96hSI23fGg",
    url: "https://www.youtube.com/shorts/z96hSI23fGg",
    title: "Mehndi glow reveal — bridal henna",
    creator: "Lashes Beauty Parlour",
    creatorUrl: "https://www.youtube.com/@Lashebeautyparlour",
    ownWork: false,
  },
  {
    platform: "youtube",
    ref: "SYkX1ZKU-lE",
    url: "https://www.youtube.com/shorts/SYkX1ZKU-lE",
    title: "Client mehndi feedback",
    creator: "Naina Goyal Mehandi",
    creatorUrl: "https://www.youtube.com/@Nainagoyalmehandinchoreo",
    ownWork: false,
  },
  {
    platform: "youtube",
    ref: "Rdu7PKl7V9I",
    url: "https://www.youtube.com/shorts/Rdu7PKl7V9I",
    title: "Mehndi colour reveal",
    creator: "Rukaiya Mehendi House",
    creatorUrl: "https://www.youtube.com/@RukaiyaMehendiHouse",
    ownWork: false,
  },
  {
    platform: "instagram",
    ref: "DMwxOHQzaFs",
    url: "https://www.instagram.com/reel/DMwxOHQzaFs/",
    title: "Mehndi reel",
    creator: "Original reel",
    ownWork: false,
  },
  {
    platform: "facebook",
    ref: "https://www.facebook.com/mehndidesignscollection/videos/mehndi-designs-for-hands/1421121699809593/",
    url: "https://www.facebook.com/mehndidesignscollection/videos/mehndi-designs-for-hands/1421121699809593/",
    title: "Mehndi designs for hands",
    creator: "Mehndi Designs Collection",
    creatorUrl: "https://www.facebook.com/mehndidesignscollection",
    ownWork: false,
  },
];

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
