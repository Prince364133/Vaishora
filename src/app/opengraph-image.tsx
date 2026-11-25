import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// Default share card (WhatsApp, Instagram, Facebook, X, LinkedIn) for every page without its own image.
export const alt = "VAISHORA — mehndi artists in Hyderabad, booked online";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const emblem = await readFile(path.join(process.cwd(), "public", "brand", "emblem.png"));
  const src = `data:image/png;base64,${emblem.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", background: "linear-gradient(135deg, #3d1734 0%, #4b1d3f 55%, #6b2a55 100%)", color: "#fffaf8", padding: "72px" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 30, letterSpacing: 10, color: "#d4af7c" }}>VAISHORA</div>
          <div style={{ fontSize: 76, lineHeight: 1.05, marginTop: 28, fontWeight: 600 }}>Mehndi artists at your home in Hyderabad</div>
          <div style={{ fontSize: 30, marginTop: 28, color: "#f8e8ec" }}>See designs in 3D · transparent prices · book online</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={260} height={260} style={{ marginLeft: 40, objectFit: "contain" }} alt="" />
      </div>
    ),
    size,
  );
}
