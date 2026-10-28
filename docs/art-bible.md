# Art bible

The look we're after: **rugged, heroic-but-grounded fantasy MMO**, in the spirit of Guild Wars 2. We describe that style in our own words and never feed ArenaNet artwork into generation tools, because our assets must be original designs we can ship.

## Style pillars
1. **Painterly materials.** Textures read as hand-painted over a realistic base: soft brushed gradients, painted edge highlights on metal, gentle ambient occlusion in the crevices. No photo-scanned grit and no plastic toy shading.
2. **Heroic proportions.** Stylized-realistic humans about 7.5 heads tall, slightly broad through the shoulders. Never chibi or stubby; hands and feet are normal sized.
3. **Layered, ornate armor.** Several overlapping plates, oversized sculpted pauldrons, raised trim and filigree bands, straps and buckles, with cloth (tabards, skirts, capes, sashes) falling between the plates.
4. **Strong silhouette.** Each class reads from across a room: shoulders, helmet crest and cloth shapes carry the identity. Some asymmetry is welcome, such as a single big pauldron or a sash on one side.
5. **Controlled color.** Mid-value, slightly desaturated base materials (steel, leather, wool) with one or two saturated accents (crimson, royal blue, teal, gold) and warm metal trim. Metal is never pure chrome or pitch black.

## Prompt blocks (reused verbatim so every asset matches)
**Style:**
> stylized realistic fantasy MMO character, hand-painted painterly textures, heroic proportions, ornate layered armor with sculpted plates and raised gold trim, soft painted highlights, rich but slightly desaturated colors with a saturated accent color, high detail game character concept

**Sheet** (for image-to-3D input):
> full-body character turnaround sheet, front view, side view and back view, standing in a relaxed A-pose, arms away from the body, empty hands, no weapons, plain light grey background, even soft studio lighting, no cast shadows, entire figure visible head to toe

**Avoid:** chibi, cartoon, toy, anime, photorealistic skin pores, weapons in hand, props, cropped feet, busy background, text, logos.

## Technical budgets
| Asset | Triangles | Textures | Notes |
|---|---|---|---|
| Player character | ~15k | 2K base color (+ normal) | A-pose, about 1.85 m, origin at the feet, facing +Z |
| Enemy | 8–12k | 1–2K | |
| Weapon / shield | 1–3k | 1K | Separate model, attached to a hand socket |

- Weapons are always separate models so weapon swapping can attach and detach them.
- Animations come from one shared biped animation file (Meshy library, with Mixamo as the fallback) and are renamed to our canonical clip names.

## Class identities (draft)
| Class | Silhouette | Palette |
|---|---|---|
| Warrior | Heavy plate, big pauldrons, tabard | Steel, crimson, gold trim (to be decided) |
| Ranger | Hooded leather and mail, quiver, long coat | Forest green, brown leather |
| Mage | Long robes, high collar, layered sashes | Deep blue or violet, silver trim |
| Rogue | Tight leathers, hood and mask, belts and blades | Charcoal, plum, dark leather |
