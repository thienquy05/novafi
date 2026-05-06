/**
 * NovaFi brand mark — inline SVG.
 * Using inline SVG (not <img>) ensures gradients and filters render
 * correctly in all browsers without CORS / same-origin restrictions.
 */
export function LogoMark({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="NovaFi"
      role="img"
    >
      <defs>
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stopColor="#3730A3" />
          <stop offset="55%"  stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#6D28D9" />
        </linearGradient>
        <radialGradient id="lm-celestial" cx="50%" cy="30%" r="42%">
          <stop offset="0%"   stopColor="#A5B4FC" stopOpacity="0.55" />
          <stop offset="60%"  stopColor="#6366F1" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#4338CA" stopOpacity="0" />
        </radialGradient>
        <filter id="lm-glow" x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="lm-arm" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="512" height="512" rx="112" fill="url(#lm-bg)" />
      <rect width="512" height="512" rx="112" fill="url(#lm-celestial)" />
      <rect width="512" height="512" rx="112" fill="none"
            stroke="white" strokeOpacity="0.07" strokeWidth="2.5" />

      {/* Baseline */}
      <line x1="136" y1="378" x2="376" y2="378"
            stroke="white" strokeOpacity="0.22" strokeWidth="10" strokeLinecap="round" />

      {/* Left arm */}
      <line x1="136" y1="378" x2="256" y2="164"
            stroke="white" strokeWidth="36" strokeLinecap="round"
            filter="url(#lm-arm)" />

      {/* Right arm */}
      <line x1="376" y1="378" x2="256" y2="164"
            stroke="white" strokeWidth="36" strokeLinecap="round"
            filter="url(#lm-arm)" />

      {/* 4-pointed star sparkle at peak */}
      <g filter="url(#lm-glow)">
        {/* Outer glow layer */}
        <path d="M256,88 L264,149 L322,158 L264,167 L256,228 L248,167 L190,158 L248,149 Z"
              fill="white" opacity="0.35" />
        {/* Core star */}
        <path d="M256,104 L263,146 L308,158 L263,170 L256,212 L249,170 L204,158 L249,146 Z"
              fill="white" />
        {/* Bright center */}
        <circle cx="256" cy="158" r="8" fill="white" />
      </g>
    </svg>
  );
}
