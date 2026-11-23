# Assets and licences used in the VAISHORA ad

No third-party footage, music, stock images or creator videos are used. The Instagram/YouTube/Facebook videos linked
by the owner (and the creator videos embedded on the site's "Real mehndi, real hands" section) are NOT used.

| Asset | Where | Source | Licence / rights |
|---|---|---|---|
| Website footage (catalogue, 3D studio, booking steps, refund policy) | `captures/*.png` | Recorded by `build/capture_site.py` from the VAISHORA dev site (localhost:3002), mobile 390×844 @3x | VAISHORA's own product UI and original design artwork. Demo artists are not shown; no booking is created. |
| Mehndi line-art motif (trust scene) | read live from `public/designs/mandala-classic-palm.svg` | VAISHORA's original generated design library | Owned by VAISHORA |
| Logo, emblem, wordmark, tagline | `build/brand/*.png` | Extracted by `build/prep_brand.py` from `Vaishora_ Beauty, Made Personal.png` (project root) | Owned by VAISHORA |
| Cormorant Garamond (variable, roman + italic) | `build/fonts/` | github.com/google/fonts `ofl/cormorantgaramond` | SIL Open Font License 1.1 (commercial use allowed; `OFL-CormorantGaramond.txt`) |
| Manrope (variable) | `build/fonts/` | github.com/google/fonts `ofl/manrope` | SIL Open Font License 1.1 (`OFL-Manrope.txt`) |
| Music bed | `audio/mix.wav` | Synthesised in `build/make_audio.py` (drone, Karplus-Strong plucks, synthetic percussion; fixed seed) | Original work for VAISHORA, no samples |
| SFX (tap, whoosh, pop, lock, chime) | `audio/mix.wav` | Synthesised in `build/make_audio.py` | Original work |
| Voiceover (Hinglish) | `audio/vo/*.wav` | `edge-tts` 7.3.1 (LGPL-3.0 client) → Microsoft neural voice `hi-IN-SwaraNeural` | **Owner must check.** edge-tts uses Microsoft Edge's online read-aloud service, and Microsoft has not given a clear commercial licence for audio made that way. Before spending on ads, either (a) set `voice.engine` to `azure` with an Azure AI Speech key (same voice; Azure's terms allow commercial use of synthesised output) or (b) record a human voice artist (set `voice.engine` to `files`, drop `audio/vo_override/<scene>.wav`). Rebuild is one command. |
| Optional Veo clips | `slots/<slot>.mp4` | Owner-generated in Google Veo 3 (not yet supplied) | Per Google's Veo terms for the owner's account. Check hands/mehndi frame by frame. |

Tools (not distributed in the video): ffmpeg 9.1 (gyan.dev full build), Python 3.13 + Playwright (Chromium), numpy, Pillow.
