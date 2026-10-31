Rightcoil / 右旋壳 — pixel art kickoff
=====================================

Assumptions
- Vertical mobile physics/path puzzle.
- Rule: snail always turns RIGHT when hitting a wall/obstacle; player only places stones.
- Signature: clockwise (rightcoil) spiral readable on shell.
- Concept / direction art — NOT dropped into engine project folders.
- Locked 6-color palette only (see PALETTE.txt). Stones MUST stay blue-gray #4A5568 family — no orange mixed into rock.

Files
- palette.png       Locked 6-swatch promo color card with HEX
- PALETTE.txt       Name + HEX list
- snail_hero.png    2x2 four-direction snail sheet; clockwise shell spiral
- stone.png         Rounded blue-gray stone prop (RGBA, transparent void)
- tiles_floor.png   Warm sand floor tiles with dark brown seams
- leaf.png          Saturated teal leaf (RGBA)
- promo_still.png   Promo still: place stones to guide right-turning snail
- preview_sheet.png Overview sheet for review
- *_raw.jpg         Source GenerateImage outputs (kept for iteration)

Production
- Path A: cursor GenerateImage + local PIL quantize/chroma (no PixelLab).
