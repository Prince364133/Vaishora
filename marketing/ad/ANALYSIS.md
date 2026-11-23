# VAISHORA ad scripts: version 1 vs version 2

**Goal of the paid ad:** *prepaid* leads. That means people who pick a design, pick a slot and **pay the 30 % advance
online**, not just people who click. So I judged each script on how well it gets a stranger in Hyderabad from scrolling
past to trusting a new website with an online payment.

Sources: `marketing/ads vidoes scripts/version 1/script.txt` (Hindi/Hinglish, 3 ads × 24 s) and `version 2/script.txt`
(Telugu, 3 ads × 24 s). Both are Veo 3 prompt packs for photoreal AI footage.

## Scorecard (1 = weak, 5 = strong, for prepaid conversion)

| Lever | V1 (Hinglish) | V2 (Telugu) | Notes |
|---|---|---|---|
| Hook (first 1.5 s) | 3 | 3 | V1 Ad 01 "Shaadi ki date fix… mehndi artist nahi mila" is a real pain, but it plays at the end of an 8 s dolly-in, so the words land around 3–5 s. V2 "College fest… mehndi sangatenti?" is light and fun but has no pain or stakes. Neither puts text on screen in the first second. |
| Problem / pain | 4 | 2 | V1 names the actual pain (no artist found, wedding pressure). V2 is aspirational ("your look is incomplete"). Aspiration gets clicks; pain gets payments. |
| Proof | 2 | 2 | Both rely on AI footage of a happy customer, which shows nothing *true* about VAISHORA. Both correctly ban fake reviews. Neither shows the real price or the real booking screens, which are the strongest honest proof we have. |
| Differentiator | 4 | 4 | Both have a "see it on the 3D hand before you book" ad (V1 Ad 02, V2 Ad 02), our one unique feature. Both correctly say "only run once the 3D hand is live". |
| Offer (price + advance) | 1 | 1 | **Biggest gap.** Neither states a price, the 30 % advance, or that the balance is paid after the session. "Price dekho" without a number does not filter for buyers. |
| Risk reversal | 0 | 0 | Neither mentions the **full refund of the advance if you cancel 48 h+ before**, or the full refund if we cannot confirm an artist. For an unknown brand asking for money up front, this is the line that turns "maybe later" into "pay now". |
| CTA | 2 | 3 | "VAISHORA par apna artist book karo" and "Vaishoralone book chesuko" are generic. Neither says what happens next (pay a small advance to lock the slot) or how to find us (no domain yet). |
| Length / pacing | 3 | 3 | 24 s as 3 × 8 s clips is a Veo constraint, not an ad structure. One idea per 8 s is too slow for Reels/Shorts, where the scene should change every 1–2 s. |
| Production risk | 2 | 2 | Every shot depends on Veo getting hands, fingers and mehndi right. Hands are exactly where AI video fails, and we have no Veo access. Blank phone screens for compositing are the right call. |
| Compliance | 4 | 4 | Good "do not" lists (no fake UI/URLs/reviews/unlaunched features). No "verified", "#1" or customer-count claims. |

## What each version does well
**Version 1 (Hindi/Hinglish)**
- Strongest *problem* framing (Ad 01: the bride with a fixed date and no artist).
- Hinglish reaches Hyderabad's mixed audience: Hindi/Urdu/Dakhni speakers, migrants in the Gachibowli–Hitech City
  corridor, and most Telugu speakers under 35.
- Ad 03 (sisters and friends) is a natural upsell to multi-person bookings, which have a higher order value.

**Version 2 (Telugu)**
- Native Telugu builds local identity and trust in Telangana, especially with families and outside the IT corridor.
- Clear audience (college girls) and a youthful tone that suits festivals, college events and Instagram.
- Better post-production checklist (subtitle rules, mobile QA, "verify booking functionality").

## What both miss for prepaid conversion
1. **No price anchor.** Price transparency is our clearest edge over "DM for price" Instagram artists, and neither ad
   says a single rupee figure.
2. **No offer framing.** "Book now" sounds like paying in full. "30 % advance locks the slot, and the rest goes to the
   artist after the session" makes it a small step.
3. **No risk reversal.** The 48-hour full-refund rule and "full refund if we can't confirm an artist" are true and
   strong. Leaving them out leaves the biggest objection unanswered.
4. **No real product footage.** The real site (price on every design, 3D hand, live slot picker, itemised quote
   *Advance to pay now ₹300 / Balance to the artist after the session ₹699*) is honest proof. It also matches what people
   see after the click, which helps landing-page conversion.
5. **Slow hook.** Text should be on screen by 0.5 s, with the pain named by 1.5 s.

## Language decision for Hyderabad
- **Master: Hinglish VO + Roman-script Hinglish captions.** Captions carry the ad for the large share who watch muted,
  Roman Hinglish is what this audience reads on Instagram, and numbers (₹399, 30 %, 48 ghante) read the same in every
  language.
- **Telugu cut as an A/B ad set:** same edit, Telugu VO (`te-IN-ShrutiNeural` or a human artist) and Telugu captions.
  The lines are in FINAL_SCRIPT.md. Target Telugu-language users and areas outside the west-IT corridor. A native
  speaker must check it first.
- English-only is not recommended as the master. It reads as "premium app" but loses warmth with the families who book
  bridal mehndi.

## Verdict
Neither version should run as written. The final ad keeps **V1's pain-led hook and Hinglish**, the **3D-hand
differentiator** from both versions' Ad 02, and **V2's production discipline**. It then adds what both lack:
- a **price anchor at ~7 s**,
- the **30 % advance offer at ~9.6 s**,
- the **48-hour full-refund risk reversal**,
- honest trust ("artists reviewed by our team"),
- a specific CTA.

It is built from real website footage, so it is true and can ship now. Veo footage becomes optional polish in named slots.
