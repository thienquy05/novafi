#!/usr/bin/env python3
"""Remove a flat magenta (#FF00FF) chroma-key background from a sprite sheet.

For image tools that can't return real alpha (e.g. a chat UI): prompt for a flat
#FF00FF background, then run this.

A pixel on the edge of the character is a blend  c = (1-b)*F + b*K  of the character
colour F and the key K. We estimate the background fraction b from how "magenta" the
pixel is -- min(R, B) - G, which is ~255 for the key and low for pinks and browns --
then solve for F, so edge pixels come out as the *true* outline colour with partial
alpha instead of a pink-tinted fringe. The ramp starts above ~30 so the character's
own pink cheeks, inner ears and heart are never touched.

    python3 key.py in.png out.png
(Magenta only. If the character itself is magenta, pick another key and edit KEY.)
"""
import sys
import numpy as np
from PIL import Image

KEY = np.array([255.0, 0.0, 255.0])
LO, HI = 30.0, 75.0   # magenta-ness below LO is never keyed; above HI is fully trusted

if len(sys.argv) != 3:
    sys.exit(__doc__)
c = np.array(Image.open(sys.argv[1]).convert('RGB'), dtype=float)
magenta = np.minimum(c[..., 0], c[..., 2]) - c[..., 1]            # 0..255
gate = np.clip((magenta - LO) / (HI - LO), 0, 1)                  # smooth on/off
b = np.clip(gate * magenta / 255.0, 0, 1)                         # background fraction
alpha = 1.0 - b
safe = np.maximum(alpha, 1e-3)[..., None]
fg = np.clip((c - b[..., None] * KEY) / safe, 0, 255)
fg[alpha < 0.02] = 0
out = np.dstack([fg, alpha * 255]).round().astype(np.uint8)
Image.fromarray(out, 'RGBA').save(sys.argv[2])
print(f'{sys.argv[2]}: {100 * (alpha < 0.5).mean():.1f}% transparent')
