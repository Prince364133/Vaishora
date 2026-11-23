# VAISHORA — final paid ad: "Rate pehle, slot pakka"

**Format:** 9:16 1080×1920 master (+ 4:5 1080×1350), ~32 s, Hinglish VO, burned-in Roman Hinglish captions.
**Objective:** prepaid bookings (design → slot → 30 % advance paid). Optimise Meta for *Purchase* / *Initiate checkout*,
not link clicks. YouTube: Demand Gen / Shorts with a conversion goal.
**Footage:** real VAISHORA website (390×844 mobile, device scale 3) and brand motion graphics. Each scene has a named
**slot**. Drop `marketing/ad/slots/<slot>.mp4` (e.g. a Veo clip) and re-render to replace that scene full-bleed.
Captions and stickers stay on top.

All prices/percentages come from `build/config.json` and must match the live site. Defaults: Minimal Dots ₹399,
Classic Mandala ₹999 (advance ₹300, balance ₹699), Royal Bridal ₹3,999, advance 30 %, full refund 48 h+, 50 % refund
12–48 h, none under 12 h.

## Scene list (timecodes from the current render)

| # | Time | Slot | Visual (default = real site) | On-screen text | VO (Hinglish, as spoken) | SFX |
|---|---|---|---|---|---|---|
| 1 HOOK | 0.0–3.4 | `hook` | Real /designs catalogue scrolling, every card showing its price. Rose sticker **“DM karo.”** slaps on at 1.4 s, then a plum strike-through crosses it out at 2.8 s (the turn). | *Mehndi ka rate poocha… reply aaya, “DM karo.”* | "Mehndi ka rate poocha, reply aaya: DM karo!" | pop |
| 2 PRICE + 3D | 3.4–9.1 | `price_3d` | Real studio: designs switch on the 3D hand (Minimal Dots → Classic Mandala → Royal Bridal) with tap rings. Ivory price tag updates in sync: **₹399 → ₹999 → ₹3,999** ("one hand"). | *VAISHORA pe design 3D haath pe dekho, price ke saath — ₹399 se shuru.* Fine print: *Price ek haath ka, design jaisa dikhaya. Final quote payment se pehle dikhega.* | "VAISHORA pe design 3D haath pe dekho, price ke saath… 399 rupaye se shuru." | whoosh, taps |
| 3 OFFER | 9.1–13.5 | `offer` | Real checkout price summary. Camera pushes in, gold boxes draw around **Advance to pay now ₹300** and **Balance to the artist after the session ₹699**. Plum sticker: *Classic Mandala · ₹999 → ₹300 · 30 % advance · slot lock*. | *Bas 30 % advance do — slot lock. Baaki session ke baad.* | "Bas 30 percent advance do, slot lock. Baaki session ke baad." | lock chime |
| 4 TRY-ON | 13.5–15.7 | `tryon` | Real 3D hand, close: tap **Back**, the hand turns to the back-hand design. | *Palm ya back — ghuma ke dekho.* | "Palm ya back, ghuma ke dekho." | tap |
| 5 SLOT | 15.7–19.0 | `slot` | Real "When and where" step: locality, date tapped, then a time slot (crossed-out times are real availability). Rose pill: **Ghar pe · Hyderabad**. | *Date, time chuno — artist aapke ghar aayenge.* | "Date, time chuno, artist aapke ghar aayenge." | taps |
| 6 RISK REVERSAL | 19.0–24.1 | `refund` | Real cancellation-policy page, gold box on **48 hours or more before the start time: full refund of the advance**. | *Plan badla? 48 ghante pehle cancel — poora advance wapas.* Fine print: *12–48 ghante pehle: 50 % refund · 12 ghante se kam: refund nahi.* | "Plan badla? 48 ghante pehle cancel, poora advance wapas." | whoosh |
| 7 TRUST | 24.1–26.7 | `artist_home` | Gold line art: VAISHORA's own mandala design draws itself stroke by stroke. (Best Veo replacement: an artist applying mehndi at home.) | *Artists ko hamari team review karti hai.* | "Artists ko hamari team review karti hai." | whoosh |
| 8 CTA / END | 26.7–32.1 | `endcard` | Gold jharokha arch, real VAISHORA logo, **Apna design chuno. *Slot lock karo.*** · **Tap “Book Now” ↓** · *or search “VAISHORA Hyderabad”* · *Book on the VAISHORA website — pay a small advance to lock your artist.* · fine print (30 % advance online · balance to the artist after the session · cancel 48h+ before: full refund of the advance · Hyderabad only) | (end card) | "Apna design chuno, slot lock karo, VAISHORA pe abhi book karo!" | chime |

Brief checks: hook text on screen at 0.1 s, pain named by 1.4 s. **Price anchor ₹399 at ~7.0 s.** **Offer (30 %
advance) at ~9.6 s.** CTA card from 26.7 s, held 5.4 s. The CTA is text with an arrow pointing at the platform's own
Book Now button, not a drawn button, because Meta rejects graphics that imitate non-working buttons.

## Why this converts to *paid* bookings
1. **The hook qualifies.** "DM karo" pain lands for people who have recently tried to book mehndi, which is high
   intent. Prices are in frame from the first frame, so the answer arrives before the question finishes.
2. **Early price anchor (₹399; the tag also shows ₹999 and ₹3,999 bridal).** Bargain browsers self-select out and buyers
   self-select in. That lowers cost per *paid* booking even if CTR falls.
3. **Small, concrete commitment.** "30 % advance → slot lock, baaki session ke baad", shown on the real itemised quote
   (₹300 now, ₹699 later), turns "pay a stranger online" into "₹300 to hold my date".
4. **Risk reversal right after the ask.** The 48-hour full refund answers "what if plans change?" before it becomes a
   reason to wait.
5. **Proof is the real UI.** The ad shows exactly what people see after the tap: same prices, slot picker and
   "Pay ₹300 advance" button. No mismatch means less drop-off.
6. **Differentiator plus convenience.** The 3D preview removes design anxiety, and "artist aapke ghar" removes travel on
   a busy function day.
7. **Muted-first.** Every claim is in captions or on the real UI, with numbers big enough to read on a phone.

## A/B hook variants (change scene 1 `caption` + `vo` in config.json; keep the rest)
- **B (time pressure, no fake timers):** *"Function next week, aur mehndi artist abhi tak fix nahi?"* — VO: "फ़ंक्शन नेक्स्ट वीक, | और मेहंदी आर्टिस्ट अभी तक फ़िक्स नहीं?"
- **C (differentiator):** *"Mehndi lagwane se pehle, design apne haath pe dekh lo."* — VO: "मेहंदी लगवाने से पहले, | डिज़ाइन अपने हाथ पे देख लो।"
- **D (price-led):** *"₹399 se mehndi artist, ghar pe — price pehle se fix."* — VO: "399 रुपये से मेहंदी आर्टिस्ट, घर पे — | प्राइस पहले से फ़िक्स।" (keep the "one hand, as shown" fine print)

Run A–D as separate ads in one ad set with the same budget. After roughly ₹1,500–2,000 spend each, judge by **cost per
paid booking**, not CTR. For B–D the "DM karo" sticker should be turned off (`"sticker": null` on scene 1).

## Telugu cut (optional second ad set; native-speaker review required)
| Scene | Telugu VO / caption |
|---|---|
| Hook | మెహందీ రేట్ అడిగితే… "DM చేయండి" అంటారు? |
| Price | వైషోరాలో డిజైన్‌ని 3D చేతిపై చూడు, ధరతో సహా — ₹399 నుంచే. |
| Offer | 30% అడ్వాన్స్ కడితే చాలు, స్లాట్ లాక్. మిగతాది సెషన్ తర్వాత. |
| Try-on | పామ్ అయినా, బ్యాక్ అయినా — తిప్పి చూడు. |
| Slot | డేట్, టైమ్ ఎంచుకో — ఆర్టిస్ట్ మీ ఇంటికే వస్తారు. |
| Refund | ప్లాన్ మారిందా? 48 గంటల ముందు క్యాన్సిల్ చేస్తే, అడ్వాన్స్ మొత్తం వాపస్. |
| Trust | ఆర్టిస్ట్‌లను మా టీమ్ రివ్యూ చేస్తుంది. |
| CTA | నీ డిజైన్ ఎంచుకో, స్లాట్ లాక్ చేసుకో — వైషోరాలో ఇప్పుడే బుక్ చేసుకో! |

To render it: set `voice.name` to `te-IN-ShrutiNeural`, put these lines into `vo` and `caption`, and add a Telugu font
(e.g. Noto Sans Telugu, OFL) to compose.html.

## Platform ad copy (ASCI-safe)
- **Primary text:** "Mehndi design 3D haath pe dekho, price pehle hi. 30% advance se slot lock, baaki session ke baad.
  48 ghante pehle cancel = poora advance wapas. Artist aapke ghar, Hyderabad mein."
- **Headline:** "Design dekho. Price dekho. Slot lock karo." **CTA button:** Book Now.
- Never add "#1", ratings, "1000+ brides", "verified artists" counts, countdowns or "only 2 slots left".

---

## Veo 3 prompt pack for the live-action slots of THIS script
**Global rules** (from the original packs): vertical 9:16, 1080p, photoreal premium Indian beauty commercial, natural
skin, correct hands (five fingers, natural nails), mehndi stained into the skin and not floating.
**Do not:** generate readable text, fake website URLs, fake app interfaces, logos or watermarks, distorted hands or
extra fingers, malformed mehndi, cartoon looks, or neon colours.
**Also:**
- **No dialogue** (our VO is added in the edit).
- Keep the **top 35 % of the frame calm**, because the captions sit there.
- Phone screens face away from camera or stay unreadable.
- Generate ~4–6 s per clip, save it as `marketing/ad/slots/<slot>.mp4`, and run the build.

**`hook` (0–3.4 s), the DM pain.** "Photoreal vertical close-up: a 26-year-old Indian woman in a soft blush kurta sits on
a sofa in a warm Hyderabad apartment, evening window light. She holds her phone with the screen facing away from
camera, reads, raises one eyebrow and lets out a small, amused-frustrated sigh, then lowers the phone. Subtle handheld
push-in, shallow depth of field, plum and ivory décor, a marigold garland and a wedding-invitation card on the table.
Natural, understated acting. No text, no readable screen, no logos, no dialogue."

**`tryon` (13.5–15.7 s), photoreal hand turn.** "Macro studio shot on a warm ivory seamless background: an elegant
Indian woman's right hand, palm to camera, with a finely detailed dark-brown henna mandala centred on the palm, banded
fingers and a dotted wrist cuff. The hand slowly rotates to show the back of the hand with matching floral henna.
Anatomically correct, five fingers, natural nails, realistic skin pores, henna stained into the skin. Soft diffused key
light, champagne-gold rim light, slow motion. No text, no logos." Use it only if the design matches a real catalogue
design (Classic Mandala / Royal Bridal). Otherwise keep the real 3D-hand footage.

**`artist_home` (24.1–26.7 s), trust and convenience.** "A professional Indian mehndi artist, around 35, in a neat plum
kurta, sits beside a customer on a floor cushion in a Hyderabad living room, applying intricate henna with a fine cone
to the customer's palm. Extreme close-up of the cone tip drawing a paisley, then a medium shot of both smiling. Warm
natural light, a professional henna kit neatly arranged. Realistic hands and henna. No text, no logos, no dialogue, no
badges or ID cards." Do not imply a certification we don't have.

**`endcard` background (optional, 26.7–32.1 s).** "Top-down still life on deep plum silk: two hands with finished bridal
henna resting at the bottom edge of the frame, scattered marigold petals and one diya. The upper 70 % of the frame is
empty plum cloth. Soft warm light, photoreal, no text." The logo and CTA render on top; check that they stay readable.

Keep `price_3d`, `offer`, `slot` and `refund` as real website footage. They are the proof, and AI-generated screens
would be fake UI.
