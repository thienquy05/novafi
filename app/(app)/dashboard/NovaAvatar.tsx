'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { STATUS_COLOR, type HealthStatus } from '@/lib/colors';

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
 * Every animation — natural blink, breathing weight, organic leaf sway — is
 * gated behind `useReducedMotion`, so it degrades to a calm, static creature.
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

/** Tail leaves (each almond + a centre vein), splaying up from a cluster base. */
const LEAVES = [
  { d: 'M44.5 50 Q40 45 39.5 37.5 Q45 40.5 46.5 48.5 Q45.5 51 44.5 50 Z', vein: 'M44.8 49.5 Q42.5 44 41 39' },
  { d: 'M45.5 50 Q42.5 42 45 34 Q49.5 40 48 49.5 Q47 51 45.5 50 Z', vein: 'M46 49 Q45.5 42 46 36' },
  { d: 'M47.5 50 Q49 44 55.5 39 Q54.5 46 50.5 50.5 Q48.5 51 47.5 50 Z', vein: 'M48.5 50 Q51 45 54 41' },
];

/** A single tail leaf that sways gently about its stem. */
function Leaf({ leaf, color, delay, reduce }: { leaf: (typeof LEAVES)[number]; color: string; delay: number; reduce: boolean | null }) {
  return (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: '50% 92%' }}
      animate={reduce ? undefined : { rotate: [-2.5, 2.5, -2.5] }}
      transition={reduce ? undefined : { duration: 3.6, repeat: Infinity, ease: 'easeInOut', delay }}
    >
      <path d={leaf.d} fill={color} stroke="#2f7a42" strokeOpacity="0.35" strokeWidth="0.5" />
      <path d={leaf.vein} fill="none" stroke="#2f7a42" strokeOpacity="0.55" strokeWidth="0.6" strokeLinecap="round" />
    </motion.g>
  );
}

/** One ear, drawn absolutely and rotated about its base by the mood's tilt. */
function Ear({ side, tilt }: { side: 'left' | 'right'; tilt: number }) {
  const dir = side === 'left' ? -1 : 1;
  const outline = side === 'left' ? EAR_L : EAR_R;
  const inner = side === 'left' ? EAR_L_IN : EAR_R_IN;
  const pivot = side === 'left' ? '22.5px 23px' : '40.5px 23px';
  return (
    <g style={{ transform: `rotate(${dir * tilt}deg)`, transformBox: 'fill-box', transformOrigin: pivot }}>
      <path d={outline} fill={FUR.shadow} stroke={FUR.line} strokeOpacity="0.4" strokeWidth="0.6" />
      <path d={inner} fill="#f7c7c0" fillOpacity="0.7" />
    </g>
  );
}

export function NovaAvatar({ status, size = 52 }: { status: HealthStatus; size?: number }) {
  const reduce = useReducedMotion();
  const color = STATUS_COLOR[status];
  const mood = MOODS[status];
  const happy = status === 'great' || status === 'good';

  // Breathing pulse — quicker & livelier when thriving, slow & heavy when stressed.
  const breath = status === 'danger' ? 4.4 : happy ? 2.8 : 3.4;

  return (
    <motion.div
      className="relative shrink-0"
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
      {/* …with a status-tinted layer so the glow still tracks financial health. */}
      <motion.div
        className="absolute inset-0 rounded-full blur-xl"
        style={{ backgroundColor: color }}
        animate={reduce ? { opacity: 0.2 } : { opacity: [0.14, 0.32, 0.14], scale: [0.9, 1.08, 0.9] }}
        transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="relative overflow-visible"
        animate={reduce ? undefined : { scale: [1, 1.035, 1] }}
        transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
        role="img"
        aria-label={`Financial health: ${status}`}
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
            <Leaf key={i} leaf={leaf} color={`url(#nova-leaf-${status})`} delay={i * 0.4} reduce={reduce} />
          ))}
        </g>

        {/* Ears (behind the head) */}
        <Ear side="left" tilt={mood.earTilt} />
        <Ear side="right" tilt={mood.earTilt} />

        {/* Body */}
        <path d={BODY} fill={`url(#nova-body-${status})`} stroke={FUR.line} strokeOpacity="0.35" strokeWidth="0.8" />
        <path d={BELLY} fill={FUR.belly} opacity="0.85" />
        {/* Soft status-tinted dapple markings + a little forehead sprout-heart */}
        <ellipse cx="21.5" cy="44" rx="3.2" ry="2.2" fill={color} opacity="0.12" />
        <ellipse cx="42" cy="46" rx="2.8" ry="2" fill={color} opacity="0.12" />
        <path d="M31.5 27 C30.4 25.6 28.8 26 28.8 27.3 C28.8 28.6 31.5 30 31.5 30 C31.5 30 34.2 28.6 34.2 27.3 C34.2 26 32.6 25.6 31.5 27 Z" fill={color} opacity="0.16" />
        {/* Fur tufts on the crown */}
        <path d={CROWN_FUR} fill="none" stroke={FUR.shadow} strokeWidth="0.9" strokeLinecap="round" />

        {/* Cheeks */}
        {mood.blush && (
          <>
            <ellipse cx="20.5" cy="35.5" rx="3.4" ry="2.2" fill={`url(#nova-blush-${status})`} />
            <ellipse cx="42.5" cy="35.5" rx="3.4" ry="2.2" fill={`url(#nova-blush-${status})`} />
          </>
        )}

        {/* Brows */}
        <path d={mood.brows[0]} fill="none" stroke={FUR.brow} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
        <path d={mood.brows[1]} fill="none" stroke={FUR.brow} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />

        {/* Eyes — large, multi-layered; the group periodically blinks (scaleY squash) */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={reduce ? undefined : { scaleY: [1, 1, 0.12, 1, 1] }}
          transition={
            reduce
              ? undefined
              : { duration: 4.6, times: [0, 0.9, 0.94, 0.97, 1], repeat: Infinity, ease: 'easeInOut' }
          }
        >
          {/* sclera */}
          <circle cx="24.5" cy="31" r="5" fill="#fffaf2" />
          <circle cx="38.5" cy="31" r="5" fill="#fffaf2" />
          {/* iris */}
          <circle cx="24.5" cy={31 + mood.pupilDy} r="3.4" fill={`url(#nova-iris-${status})`} />
          <circle cx="38.5" cy={31 + mood.pupilDy} r="3.4" fill={`url(#nova-iris-${status})`} />
          {/* status-tinted iris ring */}
          <circle cx="24.5" cy={31 + mood.pupilDy} r="3.4" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
          <circle cx="38.5" cy={31 + mood.pupilDy} r="3.4" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
          {/* pupil */}
          <circle cx="24.5" cy={31 + mood.pupilDy} r="1.9" fill="#241509" />
          <circle cx="38.5" cy={31 + mood.pupilDy} r="1.9" fill="#241509" />
          {/* layered catchlights */}
          <circle cx="23.2" cy={29.6 + mood.pupilDy} r="0.95" fill="#fff" />
          <circle cx="37.2" cy={29.6 + mood.pupilDy} r="0.95" fill="#fff" />
          <circle cx="25.4" cy={32 + mood.pupilDy} r="0.5" fill="#fff" fillOpacity="0.8" />
          <circle cx="39.4" cy={32 + mood.pupilDy} r="0.5" fill="#fff" fillOpacity="0.8" />
        </motion.g>

        {/* Nose */}
        <path
          d="M31.5 37.2 C30 36 28.8 34.6 30.2 33.8 C31 33.3 31.5 34 31.5 34 C31.5 34 32 33.3 32.8 33.8 C34.2 34.6 33 36 31.5 37.2 Z"
          fill="#6b4a36"
        />

        {/* Mouth */}
        <path
          d={mood.mouth}
          fill={mood.mouthFill ? '#6b4a36' : 'none'}
          stroke="#6b4a36"
          strokeOpacity="0.9"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Seed-pod cradled in the paws */}
        <path d={POD} fill={`url(#nova-pod-${status})`} stroke="#6e431f" strokeOpacity="0.5" strokeWidth="0.7" />
        <ellipse cx="29.5" cy="46.5" rx="2.6" ry="1.4" fill="#fff" opacity="0.18" />
        {POD_GRAIN_H.map((d, i) => (
          <path key={`h${i}`} d={d} fill="none" stroke="#b07a45" strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        ))}
        {POD_GRAIN_N.map((d, i) => (
          <path key={`n${i}`} d={d} fill="none" stroke="#5a360f" strokeOpacity="0.85" strokeWidth="1" strokeLinecap="round" />
        ))}

        {/* Paws gripping the pod */}
        <path d={PAW_L} fill="#f1d8b3" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.6" />
        <path d={PAW_R} fill="#f1d8b3" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.6" />
        <path d="M23 49 v2.4 M24.6 49 v2.4" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />
        <path d="M39.4 49 v2.4 M41 49 v2.4" stroke={FUR.line} strokeOpacity="0.5" strokeWidth="0.5" strokeLinecap="round" />

        {/* Bead of sweat when money's tight */}
        {mood.sweat && (
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
      </motion.svg>
    </motion.div>
  );
}
