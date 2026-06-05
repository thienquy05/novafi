'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { STATUS_COLOR, type HealthStatus } from '@/lib/colors';

/** Mouth shape per mood — a single quadratic curve, flat line for neutral. */
const MOUTH: Record<HealthStatus, string> = {
  great: 'M15 27 Q24 38 33 27', // big grin
  good: 'M17 28 Q24 34 31 28', // gentle smile
  warning: 'M17 31 L31 31', // straight, unsure
  danger: 'M16 33 Q24 26 32 33', // frown
  neutral: 'M18 31 L30 31', // small flat
};

/**
 * "Nova" — a little money mascot whose color and expression track the user's
 * financial health. Breathes and bobs gently (disabled under reduced motion).
 * The signature playful touch tying the abstract health score to a character.
 */
export function NovaAvatar({ status, size = 52 }: { status: HealthStatus; size?: number }) {
  const reduce = useReducedMotion();
  const color = STATUS_COLOR[status];
  const happy = status === 'great' || status === 'good';

  return (
    <motion.div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      animate={reduce ? undefined : { y: [0, -2.5, 0] }}
      transition={reduce ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Soft status glow */}
      <div
        className="absolute inset-0 rounded-full blur-lg"
        style={{ backgroundColor: color, opacity: 0.35 }}
      />
      <motion.svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        className="relative"
        animate={reduce ? undefined : { scale: [1, 1.045, 1] }}
        transition={reduce ? undefined : { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        role="img"
        aria-label={`Financial health: ${status}`}
      >
        <defs>
          <radialGradient id={`nova-${status}`} cx="35%" cy="28%" r="80%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="55%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </radialGradient>
        </defs>

        {/* Body */}
        <circle cx="24" cy="24" r="20" fill={`url(#nova-${status})`} />

        {/* Eyes — white sclera + dark pupil */}
        <circle cx="17.5" cy="20" r="3.4" fill="#fff" />
        <circle cx="30.5" cy="20" r="3.4" fill="#fff" />
        <circle cx={happy ? 18 : 17.5} cy="20.5" r="1.7" fill="#0f172a" />
        <circle cx={happy ? 31 : 30.5} cy="20.5" r="1.7" fill="#0f172a" />

        {/* Mouth */}
        <path
          d={MOUTH[status]}
          fill="none"
          stroke="#0f172a"
          strokeOpacity="0.85"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Sparkle for a thriving Nova */}
        {status === 'great' && (
          <motion.path
            d="M38 9 l1.1 2.6 2.6 1.1 -2.6 1.1 -1.1 2.6 -1.1 -2.6 -2.6 -1.1 2.6 -1.1 z"
            fill="#fff"
            animate={reduce ? undefined : { opacity: [0.4, 1, 0.4], scale: [0.85, 1.1, 0.85] }}
            transition={reduce ? undefined : { duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ transformOrigin: '39px 13px' }}
          />
        )}
      </motion.svg>
    </motion.div>
  );
}
