// Draws "Nova reborn" as the two 3x3 sprite sheets page-mascot expects, then renders
// them to transparent PNGs. Run:  node generate.mjs <path-to-playwright-module-dir>
//
//   directions.png — 9 head directions (row-major: up-left, up, up-right, left, centre,
//                    right, down-left, down, down-right), calm face, one reused body.
//   reactions.png  — 9 expressions, head straight (see EXPRESSIONS below).
//
// Every cell is a 100x100 drawing box. The bust (head + shoulders) is drawn by one
// function so the body is pixel-identical in all 18 cells.
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const OUT = dirname(fileURLToPath(import.meta.url));
const f = (n) => +n.toFixed(2);

const INK = '#35200f';
const HEAD = { cx: 50, cy: 44, rx: 28, ry: 23.5 };

// ── Fur silhouette: anchors on an ellipse joined by outward-bulging quadratics, so the
//    edge reads as tufts (pointed valleys, soft bumps) rather than a smooth blob. ──────
function furPath({ cx, cy, rx, ry }, n = 36) {
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i) => [cx + rx * Math.cos(ang(i)), cy + ry * Math.sin(ang(i))];
  let d = `M${f(pt(0)[0])} ${f(pt(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p = pt(i), q = pt(i + 1);
    const am = ang(i + 0.5);
    const phi = ((am + Math.PI / 2) * 180) / Math.PI; // 0 = top, clockwise
    const side = (phi > 70 && phi < 150) || (phi > 210 && phi < 290);
    const bulge = side ? 2.7 : phi > 150 && phi < 210 ? 1.5 : 1.2;
    const nx = Math.cos(am) / rx, ny = Math.sin(am) / ry, nl = Math.hypot(nx, ny);
    const mx = (p[0] + q[0]) / 2 + (nx / nl) * bulge * 2;
    const my = (p[1] + q[1]) / 2 + (ny / nl) * bulge * 2;
    d += ` Q${f(mx)} ${f(my)} ${f(q[0])} ${f(q[1])}`;
  }
  return d + ' Z';
}
const HEAD_PATH = furPath(HEAD);

// ── Shared defs (gradients) ─────────────────────────────────────────────────────────
const DEFS = `
<radialGradient id="fur" cx="40%" cy="30%" r="85%">
  <stop offset="0" stop-color="#fff4df"/><stop offset=".55" stop-color="#f7dcb0"/><stop offset="1" stop-color="#e0b57a"/>
</radialGradient>
<radialGradient id="muzzle" cx="50%" cy="40%" r="60%">
  <stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#fbe8c8"/>
</radialGradient>
<linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
  <stop offset="0" stop-color="#2f9a52"/><stop offset="1" stop-color="#86d87e"/>
</linearGradient>
<linearGradient id="scarf" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#58c36a"/><stop offset="1" stop-color="#2b8f4c"/>
</linearGradient>
<radialGradient id="coin" cx="38%" cy="32%" r="75%">
  <stop offset="0" stop-color="#fff0a0"/><stop offset=".6" stop-color="#ffc83a"/><stop offset="1" stop-color="#e29a12"/>
</radialGradient>
<radialGradient id="eye" cx="40%" cy="35%" r="75%">
  <stop offset="0" stop-color="#5a3a24"/><stop offset="1" stop-color="#22140b"/>
</radialGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
  <stop offset=".78" stop-color="#fff"/><stop offset=".88" stop-color="#000"/>
</linearGradient>
<clipPath id="headClip"><path d="${HEAD_PATH}"/></clipPath>
<mask id="bottomFade" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
  <rect width="100" height="100" fill="url(#fade)"/>
</mask>`;

// ── The body: drawn once, identical in every cell ───────────────────────────────────
const BODY = `
<g>
  <path d="M40 60 C35 64 30 69 30 78 C30 84 32 87 37 87 L63 87 C68 87 70 84 70 78 C70 69 65 64 60 60 Z"
        fill="url(#fur)" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M34 82 q1.4 2.4 3.2 3.6 M66 82 q-1.4 2.4 -3.2 3.6" fill="none" stroke="#c99a62" stroke-width="1" stroke-linecap="round"/>
  <!-- leaf-green scarf, a little N coin pinned to the knot -->
  <path d="M36 63.5 Q50 74 64 63.5 L65 70.5 Q50 81 35 70.5 Z" fill="url(#scarf)" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M38 66.4 Q50 75 62 66.4" fill="none" stroke="#a8ecb0" stroke-opacity=".7" stroke-width=".9" stroke-linecap="round"/>
  <circle cx="50" cy="75.6" r="5.2" fill="url(#coin)" stroke="${INK}" stroke-width="1.3"/>
  <circle cx="50" cy="75.6" r="3.7" fill="none" stroke="#c98a10" stroke-width=".6"/>
  <path d="M47.6 78.4 V72.8 L52.4 78.4 V72.8" fill="none" stroke="#8a5a08" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;

// ── Ear (viewer-left; mirrored for the right), sprout ───────────────────────────────
const EAR_OUT = 'M28 35 C21.5 27 18.5 14.5 23.5 9.8 C29 6 36.5 14 40.5 31 Z';
const EAR_IN = 'M30.5 31 C26 25 24.2 17 26.4 13 C29.6 10.8 33.6 16.6 35.6 27 Z';
function ear(side, yaw, pitch) {
  // The ear on the side the head is turning toward is foreshortened and slides back.
  const toward = side * yaw > 0 ? Math.abs(yaw) : 0;
  const away = side * yaw < 0 ? Math.abs(yaw) : 0;
  const sx = 1 - 0.38 * toward + 0.08 * away;
  const tx = yaw * 3.6 - side * toward * 3;
  const ty = -pitch * 1.4;
  const mirror = side > 0 ? 'translate(100 0) scale(-1 1)' : '';
  // transform order: shift/foreshorten in viewer space around the ear base, then mirror.
  const baseX = side < 0 ? 34 : 66;
  return `<g transform="translate(${f(tx)} ${f(ty)}) translate(${baseX} 33) scale(${f(sx)} 1) translate(${-baseX} -33)">
    <g transform="${mirror}">
      <path d="${EAR_OUT}" fill="url(#fur)" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="${EAR_IN}" fill="#f7b3bd"/>
      <path d="M27.5 19 q1.6 -2.4 3.4 -1.2" fill="none" stroke="#c99a62" stroke-width=".8" stroke-linecap="round"/>
    </g></g>`;
}
const SPROUT = `
<g stroke="#1d5a32" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">
  <path d="M50 23 Q49.6 18 51 14.5" fill="none" stroke-width="1.5"/>
  <path d="M50.4 18 C45.5 18.6 42 15.4 42.6 11.8 C47.4 11.2 50.8 14 50.4 18 Z" fill="url(#leaf)"/>
  <path d="M51.2 15.4 C55.4 14.6 58.6 11.4 58 8.4 C53.6 8.2 50.6 11.2 51.2 15.4 Z" fill="url(#leaf)"/>
  <path d="M49.4 16.4 q-3.2 -1.4 -5 -3.4 M52 12.6 q2.6 -.8 4.4 -2.4" fill="none" stroke-width=".55" stroke-opacity=".7"/>
</g>`;

// ── Face pieces ─────────────────────────────────────────────────────────────────────
function openEye(cx, cy, sx, { big = false, lookX = 0, lookY = 0 } = {}) {
  const rx = big ? 6.5 : 5.6, ry = big ? 7.6 : 6.7;
  return `<g transform="translate(${f(cx)} ${f(cy)}) scale(${f(sx)} 1)">
    <ellipse rx="${rx}" ry="${ry}" fill="url(#eye)" stroke="${INK}" stroke-width=".9"/>
    <circle cx="${f(-1.7 + lookX)}" cy="${f(-2.3 + lookY)}" r="2.15" fill="#fff"/>
    <circle cx="${f(1.9 + lookX)}" cy="${f(2.2 + lookY)}" r="1" fill="#fff" fill-opacity=".9"/>
  </g>`;
}
const arcEye = (cx, cy, sx) =>
  `<path d="M${f(cx - 5.4 * sx)} ${f(cy + 1)} Q${f(cx)} ${f(cy - 6.4)} ${f(cx + 5.4 * sx)} ${f(cy + 1)}" fill="none" stroke="${INK}" stroke-width="2.3" stroke-linecap="round"/>`;
const sleepEye = (cx, cy, sx) =>
  `<path d="M${f(cx - 5.2 * sx)} ${f(cy - 1.2)} Q${f(cx)} ${f(cy + 4.6)} ${f(cx + 5.2 * sx)} ${f(cy - 1.2)}" fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round"/>`;
function starEye(cx, cy, sx) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3.1 : 7.4, a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${f(cx + Math.cos(a) * r * sx)} ${f(cy + Math.sin(a) * r)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="#ffd23c" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>
    <circle cx="${f(cx - 1.4 * sx)}" cy="${f(cy - 1.8)}" r="1.3" fill="#fff"/>`;
}
function spiralEye(cx, cy) {
  let d = '';
  for (let i = 0; i <= 44; i++) {
    const t = i / 44, a = t * Math.PI * 5, r = 0.6 + t * 6;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="7" fill="#fffaf0" stroke="${INK}" stroke-width=".9"/>
    <path d="${d}" fill="none" stroke="${INK}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const MOUTH = {
  calm: `<path d="M50 55.2 V57.4" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round" fill="none"/>
         <path d="M45.4 57.2 Q47.8 60.4 50 57.4 Q52.2 60.4 54.6 57.2" stroke="#3a2216" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  o: `<path d="M50 55.2 V56.4" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round"/>
      <ellipse cx="50" cy="60.2" rx="2.6" ry="3.4" fill="#6b2c2c" stroke="#3a2216" stroke-width="1"/>`,
  grin: `<path d="M50 55.2 V56.4" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round"/>
         <path d="M42.6 56.6 Q50 69 57.4 56.6 Q50 59.4 42.6 56.6 Z" fill="#7a2f33" stroke="#3a2216" stroke-width="1.1" stroke-linejoin="round"/>
         <path d="M46 63.4 Q50 60.4 54 63.4 Q50 66.6 46 63.4 Z" fill="#f08a96"/>`,
  smile: `<path d="M50 55.2 V56.6" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round"/>
          <path d="M44 57 Q50 64.6 56 57 Q50 59.2 44 57 Z" fill="#7a2f33" stroke="#3a2216" stroke-width="1.05" stroke-linejoin="round"/>`,
  wavy: `<path d="M50 55.2 V56.8" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round"/>
         <path d="M43.6 59 q1.9 -2.6 3.7 0 t3.7 0 t3.7 0 t1.6 0" stroke="#3a2216" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  sleep: `<path d="M50 55.2 V57" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round"/>
          <path d="M47.4 58.8 Q50 60.6 52.6 58.8" stroke="#3a2216" stroke-width="1.1" stroke-linecap="round" fill="none"/>`,
};

const heart = (x, y, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 4 C-7 -1 -3 -7 0 -3 C3 -7 7 -1 0 4 Z" fill="#ef4565" stroke="#8d1f36" stroke-width="1" stroke-linejoin="round"/>
   <circle transform="translate(${x} ${y}) scale(${s})" cx="-2.2" cy="-2.2" r=".9" fill="#fff" fill-opacity=".85"/>`;
const sparkle = (x, y, s = 1) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -5 L1.4 -1.4 L5 0 L1.4 1.4 L0 5 L-1.4 1.4 L-5 0 L-1.4 -1.4 Z" fill="#ffd23c" stroke="#d99a10" stroke-width=".8" stroke-linejoin="round"/>`;
const zzz = `<g fill="none" stroke="#4a8fe0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M80.5 31 h5.4 l-5.4 6.2 h5.4"/><path d="M86.6 21.4 h4 l-4 4.8 h4" stroke-width="1.3"/><path d="M91.4 13.6 h3 l-3 3.6 h3" stroke-width="1.1"/></g>`;

// ── One cell: the whole bust for a given head pose + expression ─────────────────────
function nova({ yaw = 0, pitch = 0, expr = 'calm' } = {}) {
  const ay = Math.abs(yaw), ap = Math.abs(pitch);
  const L = 1 + (yaw > 0 ? 0.08 * yaw : 0.18 * yaw); // viewer-left feature scale
  const R = 1 - (yaw > 0 ? 0.18 * yaw : 0.08 * yaw); // viewer-right feature scale
  const eyeY = 47, eyeL = 39, eyeR = 61;
  const look = { lookX: yaw * 0.9, lookY: pitch * 0.9 };

  const E = {
    calm: [openEye(eyeL, eyeY, L, look), openEye(eyeR, eyeY, R, look)],
    blink: [arcEye(eyeL, eyeY, L), arcEye(eyeR, eyeY, R)],
    surprised: [openEye(eyeL, eyeY, L, { big: true }), openEye(eyeR, eyeY, R, { big: true })],
    star: [starEye(eyeL, eyeY, L), starEye(eyeR, eyeY, R)],
    sleep: [sleepEye(eyeL, eyeY, L), sleepEye(eyeR, eyeY, R)],
    dizzy: [spiralEye(eyeL, eyeY), spiralEye(eyeR, eyeY)],
  };
  const spec = {
    calm: { eyes: 'calm', mouth: 'calm' },
    blink: { eyes: 'blink', mouth: 'smile' },
    heart: { eyes: 'blink', mouth: 'smile', extra: heart(88, 21, 1.3) },
    sparkle: { eyes: 'blink', mouth: 'smile', extra: sparkle(11, 26, 1.15) + sparkle(89, 14, 1) + sparkle(91, 35, 0.8) },
    surprised: { eyes: 'surprised', mouth: 'o' },
    starstruck: { eyes: 'star', mouth: 'grin' },
    bashful: { eyes: 'blink', mouth: 'smile', blush: 1.5 },
    sleepy: { eyes: 'sleep', mouth: 'sleep', extra: zzz },
    dizzy: { eyes: 'dizzy', mouth: 'wavy' },
    delighted: { eyes: 'blink', mouth: 'grin' },
  }[expr];
  const blushOp = spec.blush ? 1 : 0.75;
  const blushR = spec.blush ? 1.35 : 1;

  return `<g mask="url(#bottomFade)">
  ${BODY}
  <g transform="translate(${f(yaw * 3.4)} ${f(pitch * 2.4)})">
    ${ear(-1, yaw, pitch)}${ear(1, yaw, pitch)}
    <path d="${HEAD_PATH}" fill="url(#fur)"/>
    <path d="M30 31 q2.4 -3.4 4.8 -.4 M66 30 q-2.4 -3.4 -4.8 -.4 M46 24.5 q2 -2.4 4 0 M50 24.5 q2 -2.4 4 0" fill="none" stroke="#d4a56c" stroke-width="1" stroke-linecap="round"/>
    <ellipse cx="29" cy="40" rx="3" ry="2.2" fill="#d9a766" fill-opacity=".35"/>
    <ellipse cx="71" cy="41" rx="3" ry="2.2" fill="#d9a766" fill-opacity=".35"/>
    ${SPROUT.replace('<g ', `<g transform="translate(${f(yaw * 1.4)} ${f(pitch * 0.8)})" `)}
    <g clip-path="url(#headClip)">
    <g transform="translate(${f(50 + yaw * 9.4)} ${f(44 + pitch * 5)}) scale(${f(1 - 0.14 * ay)} ${f(1 - 0.05 * ap)}) translate(-50 -44)">
      <g opacity="${blushOp}">
        <ellipse cx="31.5" cy="55" rx="${f(4.6 * blushR)}" ry="${f(3 * blushR)}" fill="#ff9fb2" transform="translate(31.5 55) scale(${f(L)} 1) translate(-31.5 -55)"/>
        <ellipse cx="68.5" cy="55" rx="${f(4.6 * blushR)}" ry="${f(3 * blushR)}" fill="#ff9fb2" transform="translate(68.5 55) scale(${f(R)} 1) translate(-68.5 -55)"/>
      </g>
      ${E[spec.eyes].join('')}
      <g transform="translate(${f(yaw * 3.6)} ${f(pitch * 1.6)})">
        <ellipse cx="50" cy="56.4" rx="10.4" ry="6.8" fill="url(#muzzle)"/>
        <path d="M47.2 52.6 Q50 51 52.8 52.6 Q52.4 55.4 50 55.6 Q47.6 55.4 47.2 52.6 Z" fill="#5b3a29" stroke="${INK}" stroke-width=".7" stroke-linejoin="round"/>
        <ellipse cx="49.2" cy="52.5" rx="1" ry=".5" fill="#fff" fill-opacity=".7"/>
        ${MOUTH[spec.mouth]}
      </g>
    </g>
    </g>
    <path d="${HEAD_PATH}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  </g>
  ${spec.extra ?? ''}
</g>`;
}

// ── Sheets ──────────────────────────────────────────────────────────────────────────
const DIRECTIONS = [
  { yaw: -0.9, pitch: -0.8 }, { yaw: 0, pitch: -1 }, { yaw: 0.9, pitch: -0.8 },
  { yaw: -1, pitch: 0 }, { yaw: 0, pitch: 0 }, { yaw: 1, pitch: 0 },
  { yaw: -0.9, pitch: 0.8 }, { yaw: 0, pitch: 1 }, { yaw: 0.9, pitch: 0.8 },
];
// Order matches the prompt: closed arcs, heart, sparkles, surprised, starstruck, bashful,
// sleepy, dizzy, delighted. (page-mascot's component names are blink, heart, sparkle,
// surprised, wink, bashful, sleepy, dizzy, delighted — same slots.)
const EXPRESSIONS = ['blink', 'heart', 'sparkle', 'surprised', 'starstruck', 'bashful', 'sleepy', 'dizzy', 'delighted'];

const CELL = 100, SHEET = CELL * 3;
const sheet = (cells) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET} ${SHEET}" width="${SHEET}" height="${SHEET}">
<defs>${DEFS}</defs>
${cells.map((c, i) => `<g transform="translate(${(i % 3) * CELL} ${Math.floor(i / 3) * CELL})">${nova(c)}</g>`).join('\n')}
</svg>`;

const directionsSvg = sheet(DIRECTIONS);
const reactionsSvg = sheet(EXPRESSIONS.map((expr) => ({ expr })));
writeFileSync(join(OUT, 'directions.svg'), directionsSvg);
writeFileSync(join(OUT, 'reactions.svg'), reactionsSvg);

// ── Render to transparent PNG via headless Chromium ─────────────────────────────────
const pw = createRequire(join(process.argv[2] ?? '/opt/node22/lib/node_modules', '/'))('playwright');
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 3 });
for (const [name, svg] of [['directions', directionsSvg], ['reactions', reactionsSvg]]) {
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="300" height="300"', 'width="512" height="512"')}</body></html>`);
  await page.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
}
await browser.close();
console.log('wrote directions.png / reactions.png (1536x1536)');
