'use client';
import { motion, useReducedMotion, type Transition } from 'framer-motion';
import { STATUS_COLOR, type HealthStatus } from '@/lib/colors';

/**
 * "Nova" — the money mascot. A squishy blob creature whose whole body language
 * tracks the user's financial health: it blinks, arches its brows, blushes,
 * waves its little arms and tosses coins when you're thriving — or droops,
 * furrows and sweats when spending runs hot. Every expression is data-driven
 * off `HealthStatus`, so the abstract score reads as a feeling at a glance.
 *
 * Everything is pure SVG + framer-motion (no raster assets) and every animation
 * is gated behind `useReducedMotion`, so it degrades to a calm, static face.
 */

type Mood = {
  /** Two eyebrow strokes (left, right). */
  brows: [string, string];
  /** Mouth path. */
  mouth: string;
  /** Whether the mouth is a filled shape (open grin/oh) vs a stroked line. */
  mouthFill?: boolean;
  /** Pupil vertical offset — looking up (worried) or level (content). */
  pupilDy: number;
  /** Arm pose: 'up' waves, 'side' rests, 'droop' hangs low. */
  arms: 'up' | 'side' | 'droop';
  /** Rosy cheeks. */
  blush: boolean;
  /** Bead of sweat (stress). */
  sweat: boolean;
  /** Floating coins tossed around a happy Nova. */
  coins: number;
};

/** viewBox is 0 0 64 64; body is centered on (32, 35) with r≈19. */
const MOODS: Record<HealthStatus, Mood> = {
  great: {
    brows: ['M20 23 Q25 20 29 23', 'M35 23 Q39 20 44 23'],
    mouth: 'M22 39 Q32 52 42 39 Q32 45 22 39 Z',
    mouthFill: true,
    pupilDy: 0,
    arms: 'up',
    blush: true,
    sweat: false,
    coins: 2,
  },
  good: {
    brows: ['M21 24 Q25 22 29 24', 'M35 24 Q39 22 43 24'],
    mouth: 'M24 40 Q32 47 40 40',
    pupilDy: 0,
    arms: 'side',
    blush: true,
    sweat: false,
    coins: 1,
  },
  warning: {
    brows: ['M21 23 L29 25', 'M35 25 L43 23'],
    mouth: 'M25 43 Q32 41 39 43',
    pupilDy: -0.8,
    arms: 'side',
    blush: false,
    sweat: true,
    coins: 0,
  },
  danger: {
    brows: ['M20 22 L29 26', 'M44 22 L35 26'],
    mouth: 'M23 45 Q32 37 41 45',
    pupilDy: -1.4,
    arms: 'droop',
    blush: false,
    sweat: true,
    coins: 0,
  },
  neutral: {
    brows: ['M21 24 L29 24', 'M35 24 L43 24'],
    mouth: 'M26 42 L38 42',
    pupilDy: 0,
    arms: 'side',
    blush: false,
    sweat: false,
    coins: 0,
  },
};

/** A squishy blob silhouette — not a perfect circle, gives Nova its character. */
const BLOB =
  'M32 15 C44 15 51 22 51 34 C51 45 44 53 32 53 C20 53 13 45 13 34 C13 22 20 15 32 15 Z';

/** Arm path + animation per pose. Shoulders sit on the blob's sides. */
function Arm({
  side,
  pose,
  color,
  reduce,
}: {
  side: 'left' | 'right';
  pose: Mood['arms'];
  color: string;
  reduce: boolean | null;
}) {
  const dir = side === 'left' ? -1 : 1;
  const shoulderX = side === 'left' ? 14 : 50;
  const shoulderY = 36;

  // End point of the little stub arm, per pose.
  const end =
    pose === 'up'
      ? { x: shoulderX + dir * 7, y: 22 }
      : pose === 'droop'
        ? { x: shoulderX + dir * 4, y: 48 }
        : { x: shoulderX + dir * 7, y: 40 };

  const d = `M${shoulderX} ${shoulderY} Q${shoulderX + dir * 8} ${(shoulderY + end.y) / 2} ${end.x} ${end.y}`;

  // Waving only the raised arms; resting/drooping arms stay put.
  const wave: Transition | undefined =
    reduce || pose !== 'up'
      ? undefined
      : { duration: 0.9, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: side === 'left' ? 0 : 0.18 };

  return (
    <motion.path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth="4.5"
      strokeLinecap="round"
      style={{ transformBox: 'fill-box', transformOrigin: side === 'left' ? '0% 100%' : '100% 100%' }}
      animate={wave ? { rotate: [dir * -8, dir * 10, dir * -8] } : undefined}
      transition={wave}
    />
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
      {/* Pulsing status aura */}
      <motion.div
        className="absolute inset-0 rounded-full blur-xl"
        style={{ backgroundColor: color }}
        animate={reduce ? { opacity: 0.32 } : { opacity: [0.22, 0.45, 0.22], scale: [0.92, 1.06, 0.92] }}
        transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="relative overflow-visible"
        animate={reduce ? undefined : { scale: [1, 1.04, 1] }}
        transition={reduce ? undefined : { duration: breath, repeat: Infinity, ease: 'easeInOut' }}
        role="img"
        aria-label={`Financial health: ${status}`}
      >
        <defs>
          <radialGradient id={`nova-body-${status}`} cx="34%" cy="26%" r="85%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="45%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </radialGradient>
          <radialGradient id="nova-blush" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff8aa0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#ff8aa0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Arms (behind the body so they tuck in at the shoulders) */}
        <Arm side="left" pose={mood.arms} color={color} reduce={reduce} />
        <Arm side="right" pose={mood.arms} color={color} reduce={reduce} />

        {/* Floating coins for a prospering Nova */}
        {!reduce &&
          Array.from({ length: mood.coins }).map((_, i) => {
            const cx = i === 0 ? 13 : 51;
            return (
              <motion.g
                key={i}
                animate={{ y: [0, -7, 0], opacity: [0, 1, 0], rotate: [0, i === 0 ? -20 : 20, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.9 }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                <circle cx={cx} cy={14} r="4.6" fill="#f7c948" stroke="#e0a92e" strokeWidth="1" />
                <text
                  x={cx}
                  y={14}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="6"
                  fontWeight="800"
                  fill="#8a6300"
                >
                  $
                </text>
              </motion.g>
            );
          })}

        {/* Body */}
        <path d={BLOB} fill={`url(#nova-body-${status})`} />
        {/* Soft top highlight for a glossy, gel-like body */}
        <ellipse cx="26" cy="24" rx="9" ry="6" fill="#ffffff" opacity="0.28" />

        {/* Cheeks */}
        {mood.blush && (
          <>
            <ellipse cx="22" cy="38" rx="4" ry="2.6" fill="url(#nova-blush)" />
            <ellipse cx="42" cy="38" rx="4" ry="2.6" fill="url(#nova-blush)" />
          </>
        )}

        {/* Eyebrows */}
        <path d={mood.brows[0]} fill="none" stroke="#0f172a" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
        <path d={mood.brows[1]} fill="none" stroke="#0f172a" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />

        {/* Eyes — wrapped in a group that periodically blinks (scaleY squash) */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1, 1] }}
          transition={
            reduce
              ? undefined
              : { duration: 4.2, times: [0, 0.92, 0.95, 0.98, 1], repeat: Infinity, ease: 'easeInOut' }
          }
        >
          <circle cx="25" cy="31" r="4.3" fill="#fff" />
          <circle cx="39" cy="31" r="4.3" fill="#fff" />
          <circle cx={happy ? 25.6 : 25} cy={31 + mood.pupilDy} r="2.1" fill="#0f172a" />
          <circle cx={happy ? 39.6 : 39} cy={31 + mood.pupilDy} r="2.1" fill="#0f172a" />
          {/* Catchlights */}
          <circle cx={happy ? 26.6 : 26} cy={30 + mood.pupilDy} r="0.7" fill="#fff" />
          <circle cx={happy ? 40.6 : 40} cy={30 + mood.pupilDy} r="0.7" fill="#fff" />
        </motion.g>

        {/* Mouth */}
        <path
          d={mood.mouth}
          fill={mood.mouthFill ? '#0f172a' : 'none'}
          fillOpacity={mood.mouthFill ? 0.82 : undefined}
          stroke="#0f172a"
          strokeOpacity="0.82"
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Bead of sweat when money's tight */}
        {mood.sweat && (
          <motion.path
            d="M47 24 q2.6 4 0 6 a2 2 0 1 1 0 -6 Z"
            fill="#7cc6ff"
            stroke="#4aa3e8"
            strokeWidth="0.5"
            animate={reduce ? undefined : { y: [0, 2.5, 0], opacity: [0.85, 1, 0.85] }}
            transition={reduce ? undefined : { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Sparkle crown for a thriving Nova */}
        {status === 'great' && (
          <motion.path
            d="M32 4 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 z"
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
