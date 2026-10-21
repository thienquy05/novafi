# Nova mascot — prompts for Codex and Gemini

Goal: draw the same character three ways (Claude, Codex, Gemini), run all three through the
same interactive demo, and keep whichever feels best.

Format follows [nilbuild/page-mascot](https://github.com/nilbuild/page-mascot) (MIT) so any
winner drops straight into its component, or ours: **two 3×3 PNG sheets**, transparent
background, one head-and-shoulders bust per cell.

| Sheet | Cells, row by row |
|---|---|
| `directions.png` | up-left, up, up-right / left, **centre**, right / down-left, down, down-right. Same calm face in all nine; only the head turns. |
| `reactions.png` | closed-arc eyes, heart, sparkles / surprised, starstruck, bashful / sleepy (zzz), dizzy, delighted. Head straight. |

The **same nine expressions cover every mobile gesture**, so no extra art is needed:
tap → heart / sparkle / delighted · press-and-hold → bashful · four quick taps → dizzy ·
idle → sleepy · touch while asleep → surprised.

---

## How to run it

**Fair test = prompt only.** Paste the prompts as written, with no reference image, so each
tool shows its own taste. (Optional second round: attach `claude/directions.png` to the first
prompt as "match this character" if you want identical designs.)

**Codex** (built-in image tool, real transparency): use prompts **1A** then **2A**. Turn on
the tool's *transparent background* option. Asking for transparency in the prompt alone gives
a painted checkerboard.

**Gemini** (chat, opaque images only): use prompts **1B** then **2B**. They ask for a flat
magenta background (the character has green parts, so not green). Brand-new chat per
character, exactly two messages: the directions prompt, then the expressions prompt with the
first result attached. Then remove the magenta:

```bash
python3 design/mascot/tools/key.py directions-raw.png design/mascot/gemini/directions.png
python3 design/mascot/tools/key.py reactions-raw.png  design/mascot/gemini/reactions.png
```

Save Codex's as `design/mascot/codex/{directions,reactions}.png`. If a result looks wrong
(e.g. `left` faces the viewer's right), send them over as-is — it's a column-swap fix, not a redraw.

**Compare** — from `design/mascot/`:

```bash
python3 -m http.server 3000
# http://localhost:3000/demo.html              (Claude)
# http://localhost:3000/demo.html?set=codex
# http://localhost:3000/demo.html?set=gemini
```

Open on a phone too (same Wi-Fi) to feel tap, hold, drag and the idle nap.

### Scorecard (1–5 each)
1. **Charm** — would you smile at it on the dashboard?
2. **Brand fit** — reads as Nova (cream fur, sprout, N coin), friendly-money, not a generic pet.
3. **Head-turn read** — does `left` clearly feel like the head turning, not just the eyes sliding?
4. **Consistency** — body/shoulders identical across all 18 frames; nothing jumps when frames swap.
5. **Expression clarity at 72 px** — can you tell sleepy, dizzy, bashful and delighted apart small?
6. **Clean cut-out** — no halo, checkerboard, or magenta fringe; nothing touching a cell edge.

---

## The character (`{DESCRIBE}`)

> a cute chibi forest sprite called Nova: a round, fluffy cream-furred creature with a big
> head, tall rounded ears with pink inner ears, big dark glossy eyes, a small dark-brown nose
> on a lighter cream muzzle, and a tiny green two-leaf sprout growing from the top of its head.
> It wears a leaf-green scarf around its neck with one small round gold coin pinned at the
> centre, the coin marked with a simple letter N.

(Hats, long hair, wide wings and held props are avoided on purpose: the body must be one
identical drawing in every cell.)

---

## 1A — DIRECTIONS, real-alpha tool (Codex)

```
Generate a 3x3 grid sprite sheet of a cute chibi forest sprite called Nova: a round, fluffy
cream-furred creature with a big head, tall rounded ears with pink inner ears, big dark glossy
eyes, a small dark-brown nose on a lighter cream muzzle, and a tiny green two-leaf sprout growing
from the top of its head. It wears a leaf-green scarf around its neck with one small round gold
coin pinned at the centre, the coin marked with a simple letter N. Cute storybook sticker art:
clean bold dark outlines with some weight variation, big expressive eyes each with a bright white
catchlight, soft pink cheek blush, and warm saturated colours. Give it several tones per colour --
a lighter muzzle, a darker shaded edge, coloured inner ears -- and a textured, tufted silhouette
wherever the character has fur, rather than a smooth blob. Charming and playful, full of small
appealing details. Not flat, not plain, not minimal. No photorealism, no heavy 3D gloss, no
airbrushed gradients.

This sheet is NINE HEAD DIRECTIONS, not expressions -- the face keeps the same calm friendly
expression in every cell and only the direction the head is TURNED changes.

LAYOUT: 3 columns by 3 rows, evenly spaced, fully transparent background. Each drawing is head
plus upper shoulders, centred in its cell, same character and same head size in all nine cells.

FRAMING: a PORTRAIT BUST. Head, neck and shoulders only. NO arms, NO hands, NO legs, NO lower
body. The shoulders are the lowest thing in the cell.

PROPORTIONS: a BIG HEAD chibi that still has a real body. The head is large and dominant, and the
shoulders are roughly TWO THIRDS the width of the head -- narrower than the head, but clearly
there. Do NOT draw a floating head.

THE RULE THAT MATTERS MOST: draw the BODY ONCE and reuse it. The neck, scarf, coin, chest and
shoulders must be the EXACT SAME SHAPE in the EXACT SAME POSITION in all nine cells, identical
pixels if you can. The body always faces the viewer. Do NOT redraw the body in profile when the
head turns. Only the head rotates, on top of an unchanging body.

MARGINS -- this is what goes wrong most often, so follow it literally: each character must sit
ENTIRELY INSIDE its own cell with a wide empty gap on all four sides. Draw it at roughly 75% of the
cell height, centred, leaving clear empty space above the head AND below the shoulders. The
shoulders must STOP WELL SHORT of the bottom edge of the cell -- do not let the body run off the
bottom or bleed into the cell underneath. Nothing may touch or cross a cell boundary. Shrink the
character equally in every cell if that is what it takes.

Turn the whole head clearly, do not just move the eyes: looking left swings the nose or muzzle
left and brings the far ear or cheek into view.
Row 1: up-left, up, up-right. Row 2: left, straight at the viewer, right.
Row 3: down-left, down, down-right.

NO hearts, NO sparkles, NO "zzz", NO spiral eyes -- no floating symbols of any kind. The only
lettering anywhere is the N on the coin. No other text, no labels, no borders, no drop shadows,
no background colour.
Square image, at least 1024x1024, PNG WITH A REAL ALPHA CHANNEL. The background must be genuinely
transparent, not white.
```

## 2A — EXPRESSIONS, real-alpha tool (Codex) — attach the 1A result

```
The attached image is a 3x3 head-direction sprite sheet. Produce the MATCHING EXPRESSIONS sheet
for that same character. The character is a cute chibi forest sprite called Nova: a round, fluffy
cream-furred creature with a big head, tall rounded ears with pink inner ears, big dark glossy
eyes, a small dark-brown nose on a lighter cream muzzle, and a tiny green two-leaf sprout growing
from the top of its head. It wears a leaf-green scarf around its neck with one small round gold
coin pinned at the centre, the coin marked with a simple letter N. Copy the character from the
attached image exactly: the same colours, the same markings, the same fur detail, the same line
weight. Every marking visible in the attached sheet must appear here too. Do not restyle, simplify
or redraw it.

NOT head directions. The character faces STRAIGHT AT THE VIEWER in all nine cells, head perfectly
straight. The only thing that changes between cells is the FACE, plus one small floating symbol in
three of them.

CRITICAL: same art style, same palette, same line weight, same proportions, and EXACTLY THE SAME
SIZE AND POSITION IN THE CELL as the attached sheet. The scarf, coin, chest and shoulders must be
the same drawing, the same width, and the same height off the bottom of the cell as in the
attached sheet, identical in all nine cells here. If the two sheets do not line up the character
visibly jumps, so match them.

Wide margin on all four sides, nothing touching a cell edge including the floating symbols, and
clear empty space below the shoulders. Keep symbols clear of the ears and the sprout.

The nine expressions, left to right, top to bottom:
1. Eyes closed as two upward curved arcs. No symbol.
2. Same closed arc eyes, plus one clearly visible SMALL RED HEART floating in the empty space
   beside the head. The heart must be present.
3. Same closed arc eyes, plus THREE SMALL YELLOW SPARKLE STARS around the head.
4. Eyes wide open and very round, mouth open in a small round O of surprise.
5. Starstruck: both eyes drawn as bright star shapes, big happy smile.
6. Eyes closed arcs, strong pink blush on both cheeks.
7. Eyes closed sleeping curves, plus a small blue "z z z" beside the head.
8. Both eyes drawn as spiral swirls, wavy wobbly mouth. Dizzy.
9. Eyes closed arcs, mouth wide open in a big happy grin.

The only lettering anywhere is the N on the coin and the z z z in cell 7. No other text, no
labels, no borders, no drop shadows, no background colour.
Square image, at least 1024x1024, PNG WITH A REAL ALPHA CHANNEL. The background must be genuinely
transparent, not white.
```

## 1B — DIRECTIONS, opaque tool (Gemini)

Same as **1A** with exactly two substitutions: in LAYOUT, replace `fully transparent background`
with `a solid flat pure bright magenta (#FF00FF) background filling the whole cell`, and replace
the final two lines with the block below.

```
No other text, no labels, no borders, no drop shadows. The background is one flat uniform pure
bright magenta (#FF00FF) covering the entire canvas edge to edge, with no gradient, texture,
pattern or checkerboard, and nothing else on it. Square image, at least 1024x1024.
```

(No mention of transparency anywhere. Hedging with "use magenta if you can't be transparent"
brings the checkerboard back.)

## 2B — EXPRESSIONS, opaque tool (Gemini) — attach the 1B result, **un-keyed**

Same as **2A** with the same two substitutions, plus this sentence added right after the
character description: `Draw it on the same solid pure bright magenta (#FF00FF) background
described below.` Attach the raw magenta sheet from 1B (not the keyed one), so the model copies
the background it was told to paint.

---

## Notes on our own entry (`claude/`)

- Built by `claude/generate.mjs` from vector shapes (one body function reused in all 18 cells), so
  alignment is exact by construction. Re-run: `node claude/generate.mjs <playwright-module-dir>`.
- The fur is a procedural tuft outline, so it is more regular than hand-painted fur. That is the
  main thing an image model may beat it on; the consistency and the clean cut-out are where it is strongest.
- `tools/key.py` was validated by compositing our own sheet onto magenta and keying it back:
  0 of 808,180 solid pixels changed and no magenta fringe remained.
