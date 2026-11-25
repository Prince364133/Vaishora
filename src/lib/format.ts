/** "+916205170591" → "+91 62051 70591" (Indian mobile); other values unchanged. */
export function formatPhone(p: string) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(p.replace(/\s/g, ""));
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}

export function timeAgo(d: string | Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} d ago` : new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export const percentFromBp = (bp: number) => `${(bp / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
