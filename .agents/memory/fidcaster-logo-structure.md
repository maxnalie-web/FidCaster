---
name: FidCaster logo pixel structure
description: How to extract the F symbol from fidcaster-logo-v2.png for PWA icons
---

# Rule
The logo file `fidcaster-logo-v2.png` (1024x1024 RGBA) has:
- Transparent outer corners (alpha=0)
- Dark navy background circle: rgb(29, 0, 112) — NOT the F symbol
- Light lavender F symbol: rgb ~(207, 147, 245)

To create white-background icons, use color-keying: remove pixels where distance from (29,0,112) < 60, remap remaining to brand purple (#6b26d9 = rgb(107,38,217)).

**Why:** Placing the logo directly on white gives a dark icon because the dark circle dominates. The F is embedded in the dark area and needs to be extracted.

**How to apply:**
1. Color-key with dist threshold 60 (transparent) / 120 (fade edge)
2. Find tight bbox of remaining pixels: approx (140,97)→(408,396) in 512px version
3. Crop to bbox + 10px margin → center in white canvas at 80% scale
