'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import { STATUS_COLOR, type HealthStatus } from '@/lib/colors';
import { computeLook, reactionFor, type PokeReaction } from '@/lib/mascotLook';

/**
 * "Nova" — the money mascot. A soft, fur-covered forest creature that cradles a
 * carved wooden seed-pod (a stylised "N" hidden in its grain) and trails a tail
 * of growing leaves and buds. Its whole demeanour tracks the user's financial
 * health: perky ears, a wide smile, lifted leaves and a sparkle when thriving —
 * lowered ears, a worried mouth, sagging leaves and a bead of sweat when
 * spending runs hot. Every expression is data-driven off `HealthStatus`, so the
 * abstract score reads as a feeling at a glance and stays in lock-step with the
 * dashboard's health banner.
 *
 * Pure inline SVG + framer-motion (no raster assets, no extra deps), wrapped in
 * a warm, nature-green ambient glow that subtly shifts toward the status colour.
 * Idle motion is deliberately de-synced (breathing, a slow body sway, occasional
 * blink, and per-leaf drift all run on different periods) so nothing feels
 * mechanical. When the page first loads — or the user switches back to the tab —
 * Nova lifts a paw and gives a little welcome-back wave. Everything is gated
 * behind `useReducedMotion`, so it degrades to a calm, static creature.
 *
 * Interactive, in the spirit of nilbuild/page-mascot: with a mouse or pen, Nova's
 * head turns and its eyes follow the cursor (spring-smoothed, with a dead zone so
 * it settles when the pointer is right on top of it; skipped for touch and under
 * reduced-motion). Poking Nova squashes it and flashes an expression for under a
 * second — delighted when thriving, startled when neutral, a nervous flinch when
 * spending runs hot. It's a real <button>, so Enter/Space pokes it too.
 */

type Mood = {
  /** Two soft brow strokes (left, right). */
  brows: [string, string];
  /** Mouth path. */
  mouth: string;
  /** Whether the mouth is a filled shape (open smile) vs a stroked line. */
  mouthFill?: boolean;
  /** Pupil vertical offset — looking up (worried) or level (content). */
  pupilDy: number;
  /** Ear splay in degrees — 0 perky/up, larger = lowered/droopy. */
  earTilt: number;
  /** Tail-leaf rest lift in degrees — positive lifts the cluster, negative sags it. */
  leafLift: number;
  /** Rosy cheeks. */
  blush: boolean;
  /** Bead of sweat (stress). */
  sweat: boolean;
  /** Twinkling sparkle for a thriving Nova. */
  sparkle: boolean;
};

/** viewBox is 0 0 64 64; the body is an egg centred on (32, 38). */
const MOODS: Record<HealthStatus, Mood> = {
  great: {
    brows: ['M21 24 Q24.5 22 27.5 24', 'M36.5 24 Q39.5 22 43 24'],
    mouth: 'M26.5 39 Q31.5 46 36.5 39 Q31.5 42.5 26.5 39 Z',
    mouthFill: true,
    pupilDy: 0,
    earTilt: 0,
    leafLift: 10,
    blush: true,
    sweat: false,
    sparkle: true,
  },
  good: {
    brows: ['M21.5 24.5 Q24.5 23 27.5 24.5', 'M36.5 24.5 Q39.5 23 42.5 24.5'],
    mouth: 'M27.5 40 Q31.5 44 35.5 40',
    pupilDy: 0,
    earTilt: 4,
    leafLift: 6,
    blush: true,
    sweat: false,
    sparkle: false,
  },
  warning: {
    brows: ['M21 25 L27.5 26', 'M36.5 26 L43 25'],
    mouth: 'M28.5 42 Q31.5 40.6 34.5 42',
    pupilDy: -0.6,
    earTilt: 16,
    leafLift: -2,
    blush: false,
    sweat: true,
    sparkle: false,
  },
  danger: {
    brows: ['M21 24 L27.5 27', 'M43 24 L36.5 27'],
    mouth: 'M27.5 43 Q31.5 39.4 35.5 43',
    pupilDy: -1.2,
    earTilt: 28,
    leafLift: -8,
    blush: false,
    sweat: true,
    sparkle: false,
  },
  neutral: {
    brows: ['M21.5 25 L27.5 25', 'M36.5 25 L42.5 25'],
    mouth: 'M28.5 41 Q31.5 41.7 34.5 41',
    pupilDy: 0,
    earTilt: 8,
    leafLift: 2,
    blush: false,
    sweat: false,
    sparkle: false,
  },
};

/** Warm fur palette — consistent across statuses so Nova reads as one creature;
 *  the status colour comes through in the glow, iris ring, ears, pattern. */
const FUR = {
  base: '#f1d8b3',
  shadow: '#e7c79f',
  belly: '#fdf1de',
  line: '#c9a274',
  brow: '#7a5538',
};

/** Soft, slightly pear-shaped furry body. */
const BODY =
  'M31.5 18 C43 18 49 27 49 39 C49 51 42 58 31.5 58 C21 58 14 51 14 39 C14 27 20 18 31.5 18 Z';
/** Lighter belly patch. */
const BELLY =
  'M31.5 33 C39 33 42 40 42 47 C42 53 37 57 31.5 57 C26 57 21 53 21 47 C21 40 24 33 31.5 33 Z';
/** Furry tufts on the crown for soft texture. */
const CROWN_FUR = 'M24 22 q2 -3 4 0 M29.5 20.5 q2 -3 4 0 M35 22 q2 -3 4 0';
/** Wispy fur flicks along the lower silhouette so the edge reads as soft fur. */
const SIDE_FUR = 'M15 41 q-1.6 2 0.4 3.6 M15.6 46 q-1.6 2 0.4 3.6 M48.5 41 q1.6 2 -0.4 3.6 M47.9 46 q1.6 2 -0.4 3.6';

/** Ears — base points (left ≈ 22.5,23 · right ≈ 40.5,23) are the tilt pivots. */
const EAR_R = 'M37 23 C38 14 41 10 44.5 12.5 C47 15 44.5 20 42 23 Z';
const EAR_R_IN = 'M39 22 C40 15.5 42 13 43.5 15 C45 17 43.5 20 41.5 22 Z';
const EAR_L = 'M26 23 C25 14 22 10 18.5 12.5 C16 15 18.5 20 21 23 Z';
const EAR_L_IN = 'M24 22 C23 15.5 21 13 19.5 15 C18 17 19.5 20 21.5 22 Z';

/** Carved wooden seed-pod cradled in Nova's paws. */
const POD =
  'M31.5 43.5 C36.5 44.5 39 48 38 51.5 C37 55 34 57 31.5 57 C29 57 26 55 25 51.5 C24 48 26.5 44.5 31.5 43.5 Z';
/** The three grain strokes that read as an "N" worked into the wood. */
const POD_GRAIN_N = ['M28.5 47.5 Q28 51 28.5 54.4', 'M28.6 47.9 Q31.5 51 34.4 54.1', 'M34.5 47.5 Q35 51 34.5 54.4'];
/** Faint horizontal grain arcs across the pod. */
const POD_GRAIN_H = ['M27 49.2 Q31.5 50.2 36 49.2', 'M26.6 52 Q31.5 53 36.4 52'];

/** Little paws gripping the pod's shoulders. */
const PAW_L = 'M22 47 C20.5 49 21 52 23.5 52 C26 52 27 49.5 26 47.5 C25 46 23 46 22 47 Z';
const PAW_R = 'M41 47 C42.5 49 42 52 39.5 52 C37 52 36 49.5 37 47.5 C38 46 40 46 41 47 Z';

/** Raised furry forearm + open paw, used only for the welcome-back wave. Drawn
 *  in its "up" pose and oscillated about the shoulder pivot (43, 46). */
const WAVE_ARM =
  'M41 47 C44 42 48 36 50.5 31 C52.4 31.6 52.8 34.5 51.3 37.6 C49.6 41 46 46 43.5 48.5 C42.2 48.8 41 48.2 41 47 Z';

/** Tail leaves (each almond + a centre vein), splaying up from a cluster base.
 *  Each carries its own gentle sway timing so the cluster never moves in unison. */
const LEAVES = [
  { d: 'M44.5 50 Q40 45 39.5 37.5 Q45 40.5 46.5 48.5 Q45.5 51 44.5 50 Z', vein: 'M44.8 49.5 Q42.5 44 41 39', dur: 3.4, amp: 2.0 },
  { d: 'M45.5 50 Q42.5 42 45 34 Q49.5 40 48 49.5 Q47 51 45.5 50 Z', vein: 'M46 49 Q45.5 42 46 36', dur: 4.2, amp: 3.0 },
  { d: 'M47.5 50 Q49 44 55.5 39 Q54.5 46 50.5 50.5 Q48.5 51 47.5 50 Z', vein: 'M48.5 50 Q51 45 54 41', dur: 3.7, amp: 2.4 },
];

/** A single tail leaf that sways and bobs gently about its stem. */
function Leaf({ leaf, color, delay, reduce }: { leaf: (typeof LEAVES)[number]; color: string; delay: number; reduce: boolean | null }) {
  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: '50% 92%' }}
      animate={reduce ? undefined : { rotate: [-leaf.amp, leaf.amp, -leaf.amp], y: [0, -0.7, 0] }}
      transition={
        reduce
          ? undefined
          : {
              rotate: { duration: leaf.dur, repeat: Infinity, ease: 'easeInOut', delay },
              y: { duration: leaf.dur * 1.35, repeat: Infinity, ease: 'easeInOut', delay },
            }
      }
    >
      <path d={leaf.d} fill={color} stroke="#2f7a42" strokeOpacity="0.35" strokeWidth="0.5" />
      <path d={leaf.vein} fill="none" stroke="#2f7a42" strokeOpacity="0.55" strokeWidth="0.6" strokeLinecap="round" />
    </motion.g>
  );
}

/** One ear — splayed by the mood's tilt, with a soft idle wiggle for life. */
function Ear({ side, tilt, reduce }: { side: 'left' | 'right'; tilt: number; reduce: boolean | null }) {
  const dir = side === 'left' ? -1 : 1;
  const base = dir * tilt;
  const outline = side === 'left' ? EAR_L : EAR_R;
  const inner = side === 'left' ? EAR_L_IN : EAR_R_IN;
  const pivot = side === 'left' ? '22.5px 23px' : '40.5px 23px';
  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: pivot }}
      animate={reduce ? { rotate: base } : { rotate: [base - 1.6, base + 1.6, base - 1.6] }}
      transition={reduce ? undefined : { duration: 4.6, repeat: Infinity, ease: 'easeInOut', delay: side === 'left' ? 0 : 0.5 }}
    >
      <path d={outline} fill={FUR.shadow} stroke={FUR.line} strokeOpacity="0.4" strokeWidth="0.6" />
      <path d={inner} fill="#f7c7c0" fillOpacity="0.7" />
    </motion.g>
  );
}

/** Expression overrides shown for a moment after Nova is poked. */
const JOY_EYES = ['M20.5 31.5 Q24.5 27 28.5 31.5', 'M34.5 31.5 Q38.5 27 42.5 31.5'];
const SURPRISE_MOUTH = 'M31.5 38.6 C29.6 38.6 29.2 43.4 31.5 43.4 C33.8 43.4 33.4 38.6 31.5 38.6 Z';
const WORRY_MOUTH = 'M27 42 q1.3 -1.6 2.6 0 t2.6 0 t2.6 0';

/** Squash/shake keyframes for the poke, played on the element wrapping the SVG
 *  (anchored at its feet so Nova squashes into the ground rather than the centre). */
const SQUASH: Record<PokeReaction, { scaleX?: number[]; scaleY?: number[]; x?: number[]; y?: number[]; transition: { duration: number; ease: 'easeOut' | 'easeInOut' } }> = {
  joy: { scaleX: [1, 1.14, 0.96, 1], scaleY: [1, 0.84, 1.07, 1], y: [0, 0, -5, 0], transition: { duration: 0.55, ease: 'easeOut' } },
  surprise: { scaleX: [1, 1.1, 1], scaleY: [1, 0.88, 1], transition: { duration: 0.4, ease: 'easeOut' } },
  worry: { x: [0, -3, 3, -2, 2, 0], scaleX: [1, 1.05, 1], scaleY: [1, 0.93, 1], transition: { duration: 0.5, ease: 'easeInOut' } },
};

/** Gold stars that burst outward when a thriving Nova is poked: [x, y, dx, dy]. */
const BURST = [
  [13, 15, -6, -5],
  [51, 15, 6, -5],
  [8, 34, -7, 0],
  [56, 34, 7, 0],
];

export function NovaAvatar({ status, size = 52 }: { status: HealthStatus; size?: number }) {
  const reduce = useReducedMotion();
  const color = STATUS_COLOR[status];
  const mood = MOODS[status];
  const happy = status === 'great' || status === 'good';

  // ── Cursor following ───────────────────────────────────────────────────────
  // The pointer's offset from Nova's centre becomes a spring-smoothed gaze in
  // [-1, 1]². It drives a small whole-head turn, a slight shift of the face, and
  // a bigger shift of the irises — layered so the head reads as turning, not just
  // the eyes sliding about. Mouse/pen only; touch has no hovering cursor.
  const wrapRef = useRef<HTMLButtonElement>(null);
  const lookX = useMotionValue(0);
  const lookY = useMotionValue(0);
  const gazeX = useSpring(lookX, { stiffness: 170, damping: 18, mass: 0.6 });
  const gazeY = useSpring(lookY, { stiffness: 170, damping: 18, mass: 0.6 });
  const headRotate = useTransform(gazeX, (v) => v * 4);
  const faceX = useTransform(gazeX, (v) => v * 1.5);
  const faceY = useTransform(gazeY, (v) => v * 1);
  const irisX = useTransform(gazeX, (v) => v * 1.5);
  const irisY = useTransform(gazeY, (v) => v * 1.3);

  useEffect(() => {
    if (reduce) return;
    let pointer: { x: number; y: number } | null = null;

    const aim = () => {
      const el = wrapRef.current;
      if (!el || !pointer) return;
      const r = el.getBoundingClientRect();
      const look = computeLook(pointer.x - (r.left + r.width / 2), pointer.y - (r.top + r.height / 2), size * 0.55);
      lookX.set(look.x);
      lookY.set(look.y);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      pointer = { x: e.clientX, y: e.clientY };
      aim();
    };
    const recentre = () => {
      pointer = null;
      lookX.set(0);
      lookY.set(0);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', aim, { passive: true }); // Nova moves under a still cursor
    window.addEventListener('blur', recentre);
    document.documentElement.addEventListener('mouseleave', recentre);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', aim);
      window.removeEventListener('blur', recentre);
      document.documentElement.removeEventListener('mouseleave', recentre);
    };
  }, [reduce, size, lookX, lookY]);

  // ── Poke reaction ──────────────────────────────────────────────────────────
  // A click (or Enter/Space) squashes Nova and swaps in a short-lived expression.
  // The expression still shows under reduced-motion; only the squash/burst don't.
  const [reaction, setReaction] = useState<PokeReaction | null>(null);
  const [pokes, setPokes] = useState(0);
  const squash = useAnimationControls();
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const poke = () => {
    const kind = reactionFor(status);
    setReaction(kind);
    setPokes((n) => n + 1);
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), kind === 'joy' ? 900 : 700);
    if (!reduce) squash.start(SQUASH[kind]);
  };
  useEffect(() => () => clearTimeout(reactionTimer.current), []);

  const joy = reaction === 'joy';
  const surprise = reaction === 'surprise';
  const worry = reaction === 'worry';
  const brows = worry ? MOODS.danger.brows : joy ? MOODS.great.brows : mood.brows;
  const mouth = joy ? MOODS.great.mouth : surprise ? SURPRISE_MOUTH : worry ? WORRY_MOUTH : mood.mouth;
  const mouthFill = joy ? true : surprise ? true : mood.mouthFill;
  const earTilt = joy || surprise ? 0 : worry ? Math.max(mood.earTilt, 24) : mood.earTilt;
  const pupilR = surprise || worry ? 1.3 : 1.9;
  const showBlush = mood.blush || joy;
  const showSweat = mood.sweat || worry;

  // Breathing pulse — quicker & livelier when thriving, slow & heavy when stressed.
  const breath = status === 'danger' ? 4.4 : happy ? 2.8 : 3.4;

  // ── Welcome-back wave ──────────────────────────────────────────────────────
  // Fires once on mount and whenever the tab regains visibility. The right paw
  // lifts off the pod, waves a few times, then settles back. Throttled so rapid
  // tab-flicking doesn't spam it; fully skipped under reduced-motion.
  const [waving, setWaving] = useState(false);
  const wave = useAnimationControls();
  const lastGreet = useRef(0);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;

    const greet = async () => {
      const now = Date.now();
      if (now - lastGreet.current < 20000) return; // at most once per 20s
      lastGreet.current = now;
      setWaving(true);
      try {
        await wave.start({ opacity: 1, scale: 1, transition: { duration: 0.28, ease: 'easeOut' } });
        await wave.start({ rotate: [2, 18, 0, 16, 2, 14, 4], transition: { duration: 1.35, ease: 'easeInOut' } });
        await wave.start({ opacity: 0, scale: 0.9, transition: { duration: 0.3, ease: 'easeIn' } });
      } catch {
        /* controls unmounted mid-sequence */
      }
      if (!cancelled) setWaving(false);
    };

    greet();
    const onVisible = () => { if (document.visibilityState === 'visible') greet(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reduce, wave]);

  return (
    <motion.button
      ref={wrapRef}
      type="button"
      onClick={poke}
      aria-label={`Nova, your financial health companion — status: ${status}. Press to poke.`}
      className="relative shrink-0 cursor-pointer select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2"
      style={{ width: size, height: size }}
      animate={reduce ? undefined : { y: [0, -3, 0] }}
      transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Warm nature glow — soft green base layer… */}
      <motion.div
        className="absolute inset-0 rounded-full blur-xl"
        style={{ backgroundColor: '#a6d49a' }}
        animate={reduce ? { opacity: 0.3 } : { opacity: [0.24, 0.4, 0.24], scale: [0.94, 1.04, 0.94] }}
        transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* …with a status-tinted layer (slightly de-synced) so the glow shimmers naturally. */}
      <motion.div
        className="absolute inset-0 rounded-full blur-xl"
        style={{ backgroundColor: color }}
        animate={reduce ? { opacity: 0.2 } : { opacity: [0.14, 0.32, 0.14], scale: [0.9, 1.08, 0.9] }}
        transition={reduce ? undefined : { duration: breath * 1.25, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Squash/shake wrapper — kept separate so it never fights the idle loops below. */}
      <motion.div
        className="relative"
        style={{ width: size, height: size, transformOrigin: '50% 100%' }}
        animate={squash}
      >
      <motion.svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="relative overflow-visible"
        aria-hidden="true"
        animate={reduce ? undefined : { scale: [1, 1.035, 1], rotate: [-1.1, 1.1, -1.1] }}
        transition={
          reduce
            ? undefined
            : {
                scale: { duration: breath, repeat: Infinity, ease: 'easeInOut' },
                rotate: { duration: breath * 1.7, repeat: Infinity, ease: 'easeInOut' },
              }
        }
      >
        <defs>
          <radialGradient id={`nova-body-${status}`} cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#fbe8d2" />
            <stop offset="55%" stopColor="#f1d8b3" />
            <stop offset="100%" stopColor="#e3c191" />
          </radialGradient>
          <radialGradient id={`nova-iris-${status}`} cx="42%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#a9764a" />
            <stop offset="100%" stopColor="#5b3a23" />
          </radialGradient>
          <radialGradient id={`nova-pod-${status}`} cx="40%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#cf9457" />
            <stop offset="100%" stopColor="#8a5a2c" />
          </radialGradient>
          <linearGradient id={`nova-leaf-${status}`} x1="0" y1="1" x2="0.6" y2="0">
            <stop offset="0%" stopColor="#3f9a52" />
            <stop offset="100%" stopColor="#7ac77e" />
          </linearGradient>
          <radialGradient id={`nova-blush-${status}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff8aa0" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ff8aa0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Tail — leaves + buds, lifted/sagged by mood, sprouting from behind the body */}
        <g style={{ transform: `rotate(${-mood.leafLift}deg)`, transformBox: 'fill-box', transformOrigin: '45px 51px' }}>
          <path d="M44 52 Q45.5 50 47.5 50" fill="none" stroke="#3f9a52" strokeWidth="1.4" strokeLinecap="round" />
          <ellipse cx="43.6" cy="51" rx="2" ry="2.6" fill={`url(#nova-leaf-${status})`} />
          <ellipse cx="50" cy="51.4" rx="1.6" ry="2.1" fill={`url(#nova-leaf-${status})`} />
          <circle cx="43.6" cy="49" r="0.9" fill="#f4a8ba" />
          <circle cx="50" cy="49.6" r="0.8" fill="#f4a8ba" />
          {LEAVES.map((leaf, i) => (
            <Leaf key={i} leaf={leaf} color={`url(#nova-leaf-${status})`} delay={i * 0.45} reduce={reduce} />
          ))}
        </g>

        {/* Head — ears, body and face turn together toward the cursor, pivoting at the feet */}
        <motion.g style={{ rotate: headRotate, transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        {/* Ears (behind the head) */}
        <Ear side="left" tilt={earTilt} reduce={reduce} />
        <Ear side="right" tilt={earTilt} reduce={reduce} />

        {/* Body */}
        <path d={BODY} fill={`url(#nova-body-${status})`} stroke={FUR.line} strokeOpacity="0.35" strokeWidth="0.8" />
        <path d={BELLY} fill={FUR.belly} opacity="0.85" />
        {/* Soft status-tinted dapple markings + a little forehead sprout-heart */}
        <ellipse cx="21.5" cy="44" rx="3.2" ry="2.2" fill={color} opacity="0.12" />
        <ellipse cx="42" cy="46" rx="2.8" ry="2" fill={color} opacity="0.12" />
        <path d="M31.5 27 C30.4 25.6 28.8 26 28.8 27.3 C28.8 28.6 31.5 30 31.5 30 C31.5 30 34.2 28.6 34.2 27.3 C34.2 26 32.6 25.6 31.5 27 Z" fill={color} opacity="0.16" />
        {/* Fur tufts on the crown + soft fur flicks on the lower silhouette */}
        <path d={CROWN_FUR} fill="none" stroke={FUR.shadow} strokeWidth="0.9" strokeLinecap="round" />
        <path d={SIDE_FUR} fill="none" stroke={FUR.shadow} strokeOpacity="0.7" strokeWidth="0.8" strokeLinecap="round" />

        {/* Face — shifts a touch toward the cursor on top of the head turn */}
        <motion.g style={{ x: faceX, y: faceY }}>
        {/* Cheeks */}
        {showBlush && (
          <>
            <ellipse cx="20.5" cy="35.5" rx="3.4" ry="2.2" fill={`url(#nova-blush-${status})`} />
            <ellipse cx="42.5" cy="35.5" rx="3.4" ry="2.2" fill={`url(#nova-blush-${status})`} />
          </>
        )}

        {/* Brows — lifted when startled */}
        <g transform={surprise ? 'translate(0 -1.6)' : undefined}>
          <path d={brows[0]} fill="none" stroke={FUR.brow} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
          <path d={brows[1]} fill="none" stroke={FUR.brow} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
        </g>

        {/* Eyes — large, multi-layered; the group blinks naturally (quick close, softer open).
            When poked with joy they squeeze into happy arcs instead. */}
        {joy ? (
          JOY_EYES.map((d, i) => (
            <path key={i} d={d} fill="none" stroke={FUR.brow} strokeOpacity="0.9" strokeWidth="1.8" strokeLinecap="round" />
          ))
        ) : (
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={reduce ? undefined : { scaleY: [1, 1, 0.08, 1, 1] }}
          transition={
            reduce
              ? undefined
              : { duration: 5.2, times: [0, 0.92, 0.945, 0.99, 1], repeat: Infinity, ease: 'easeInOut' }
          }
        >
          {/* sclera */}
          <circle cx="24.5" cy="31" r="5" fill="#fffaf2" />
          <circle cx="38.5" cy="31" r="5" fill="#fffaf2" />
          {/* iris + pupil + catchlights glide together toward the cursor */}
          <motion.g style={{ x: irisX, y: irisY }}>
            {/* iris */}
            <circle cx="24.5" cy={31 + mood.pupilDy} r="3.4" fill={`url(#nova-iris-${status})`} />
            <circle cx="38.5" cy={31 + mood.pupilDy} r="3.4" fill={`url(#nova-iris-${status})`} />
            {/* status-tinted iris ring */}
            <circle cx="24.5" cy={31 + mood.pupilDy} r="3.4" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
            <circle cx="38.5" cy={31 + mood.pupilDy} r="3.4" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
            {/* pupil — pinpricks when startled or nervous */}
            <circle cx="24.5" cy={31 + mood.pupilDy} r={pupilR} fill="#241509" />
            <circle cx="38.5" cy={31 + mood.pupilDy} r={pupilR} fill="#241509" />
            {/* layered catchlights */}
            <circle cx="23.2" cy={29.6 + mood.pupilDy} r="0.95" fill="#fff" />
            <circle cx="37.2" cy={29.6 + mood.pupilDy} r="0.95" fill="#fff" />
            <circle cx="25.4" cy={32 + mood.pupilDy} r="0.5" fill="#fff" fillOpacity="0.8" />
            <circle cx="39.4" cy={32 + mood.pupilDy} r="0.5" fill="#fff" fillOpacity="0.8" />
          </motion.g>
        </motion.g>
        )}

        {/* Nose */}
        <path
          d="M31.5 37.2 C30 36 28.8 34.6 30.2 33.8 C31 33.3 31.5 34 31.5 34 C31.5 34 32 33.3 32.8 33.8 C34.2 34.6 33 36 31.5 37.2 Z"
          fill="#6b4a36"
        />

        {/* Mouth */}
        <path
          d={mouth}
          fill={mouthFill ? '#6b4a36' : 'none'}
          stroke="#6b4a36"
          strokeOpacity="0.9"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        </motion.g>
        </motion.g>

        {/* Seed-pod cradled in the paws */}
        <path d={POD} fill={`url(#nova-pod-${status})`} stroke="#6e431f" strokeOpacity="0.5" strokeWidth="0.7" />
        <ellipse cx="29.5" cy="46.5" rx="2.6" ry="1.4" fill="#fff" opacity="0.18" />
        {POD_GRAIN_H.map((d, i) => (
          <path key={`h${i}`} d={d} fill="none" stroke="#b07a45" strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        ))}
        {POD_GRAIN_N.map((d, i) => (
          <path key={`n${i}`} d={d} fill="none" stroke="#5a360f" strokeOpacity="0.85" strokeWidth="1" strokeLinecap="round" />
        ))}

        {/* Left paw always grips the pod. The right paw lifts off when waving. */}
        <path d={PAW_L} fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.6" />
        <path d="M23 49 v2.4 M24.6 49 v2.4" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        <motion.g animate={{ opacity: waving ? 0 : 1 }} transition={{ duration: 0.2 }}>
          <path d={PAW_R} fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.6" />
          <path d="M39.4 49 v2.4 M41 49 v2.4" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        </motion.g>

        {/* Welcome-back wave arm — hidden until greeting, oscillates about the shoulder */}
        <motion.g
          initial={{ opacity: 0, scale: 0.9 }}
          animate={wave}
          style={{ transformBox: 'fill-box', transformOrigin: '43px 46px' }}
        >
          <path d={WAVE_ARM} fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.6" />
          {/* little toe pads so it reads as an open, waving paw */}
          <circle cx="49.4" cy="30.4" r="1" fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" />
          <circle cx="51.4" cy="30" r="1" fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" />
          <circle cx="52.8" cy="31.4" r="0.9" fill={FUR.base} stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" />
        </motion.g>

        {/* Bead of sweat when money's tight */}
        {showSweat && (
          <motion.path
            d="M45 25 q2.4 3.6 0 5.4 a1.8 1.8 0 1 1 0 -5.4 Z"
            fill="#7cc6ff"
            stroke="#4aa3e8"
            strokeWidth="0.5"
            animate={reduce ? undefined : { y: [0, 2.4, 0], opacity: [0.85, 1, 0.85] }}
            transition={reduce ? undefined : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Sparkle for a thriving Nova */}
        {mood.sparkle && (
          <motion.path
            d="M31.5 5 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4 z"
            fill="#fff"
            animate={reduce ? undefined : { opacity: [0.4, 1, 0.4], scale: [0.8, 1.15, 0.8], rotate: [0, 20, 0] }}
            transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        )}

        {/* Gold star burst on a joyful poke — re-keyed per poke so rapid clicks restart it */}
        {joy && !reduce &&
          BURST.map(([cx, cy, dx, dy], i) => (
            <g key={`${pokes}-${i}`} transform={`translate(${cx} ${cy})`}>
              <motion.path
                d="M0 -3 l0.9 2.1 2.1 0.9 -2.1 0.9 -0.9 2.1 -0.9 -2.1 -2.1 -0.9 2.1 -0.9 z"
                fill="#ffd76a"
                stroke="#e8a92c"
                strokeWidth="0.3"
                initial={{ opacity: 1, scale: 0.4, x: 0, y: 0 }}
                animate={{ opacity: 0, scale: 1.2, x: dx, y: dy }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.04 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            </g>
          ))}
      </motion.svg>
      </motion.div>
    </motion.button>
  );
}
