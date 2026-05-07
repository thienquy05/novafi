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
        {/* Sky blue gradient: deep navy → medium sky → lighter sky */}
        <linearGradient id="lm-bg" x1="0.2" y1="1" x2="0.8" y2="0" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stopColor="#0B3B62" />
          <stop offset="50%"  stopColor="#1565A3" />
          <stop offset="100%" stopColor="#2E93D4" />
        </linearGradient>
        {/* Atmospheric shimmer at top-center */}
        <radialGradient id="lm-atm" cx="50%" cy="18%" r="42%">
          <stop offset="0%"   stopColor="#7EC8E8" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#7EC8E8" stopOpacity="0" />
        </radialGradient>
        {/* Crown fill: white at top → icy blue at bottom for depth */}
        <linearGradient id="lm-crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#D8EFFF" stopOpacity="0.86" />
        </linearGradient>
        {/* Gold gradient for luxury accents */}
        <linearGradient id="lm-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#FFF0A8" />
          <stop offset="45%"  stopColor="#E4BF40" />
          <stop offset="100%" stopColor="#C49918" />
        </linearGradient>
        {/* Star glow */}
        <filter id="lm-glow" x="-120%" y="-120%" width="340%" height="340%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Crown subtle drop shadow (feOffset+feMerge — wider compatibility) */}
        <filter id="lm-shadow" x="-5%" y="-5%" width="110%" height="115%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur" />
          <feOffset dx="0" dy="3" result="offset" />
          <feFlood floodColor="#0B3B62" floodOpacity="0.28" result="color" />
          <feComposite in="color" in2="offset" operator="in" result="shadow" />
          <feMerge>
            <feMergeNode in="shadow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background — inline style overrides any CSS fill reset */}
      <rect width="512" height="512" rx="112" style={{ fill: 'url(#lm-bg)' }} />
      <rect width="512" height="512" rx="112" style={{ fill: 'url(#lm-atm)' }} />
      <rect width="512" height="512" rx="112" style={{ fill: 'none', stroke: 'white', strokeOpacity: 0.08, strokeWidth: 2.5 }} />

      {/* Crown — open 3-tine silhouette + band
          Left tine:   base 148–192 (center 170), peak (170, 228)
          Center tine: base 224–288 (center 256), peak (256, 148)
          Right tine:  base 320–364 (center 342), peak (342, 228)
          Band: x=136–376, y=354–396                              */}
      <path
        d="M 136 396 L 136 354 L 148 354 L 170 228 L 192 354 L 224 354 L 256 148 L 288 354 L 320 354 L 342 228 L 364 354 L 376 354 L 376 396 Z"
        style={{ fill: 'url(#lm-crown)', filter: 'url(#lm-shadow)' }}
      />

      {/* Band top decorative separator */}
      <rect x="136" y="354" width="240" height="3" style={{ fill: 'white', fillOpacity: 0.18 }} />

      {/* Gold gem dots on crown band */}
      <circle cx="176" cy="376" r="7"  style={{ fill: 'url(#lm-gold)', opacity: 0.80 }} />
      <circle cx="216" cy="376" r="6"  style={{ fill: 'url(#lm-gold)', opacity: 0.70 }} />
      <circle cx="256" cy="376" r="8"  style={{ fill: 'url(#lm-gold)', opacity: 0.92 }} />
      <circle cx="296" cy="376" r="6"  style={{ fill: 'url(#lm-gold)', opacity: 0.70 }} />
      <circle cx="336" cy="376" r="7"  style={{ fill: 'url(#lm-gold)', opacity: 0.80 }} />

      {/* Gold diamonds at side tine peaks */}
      <path d="M170,218 L178,228 L170,238 L162,228 Z" style={{ fill: 'url(#lm-gold)', opacity: 0.85 }} />
      <path d="M342,218 L350,228 L342,238 L334,228 Z" style={{ fill: 'url(#lm-gold)', opacity: 0.85 }} />

      {/* 4-pointed star sparkle at center tine peak (256, 148) */}
      <g style={{ filter: 'url(#lm-glow)' }}>
        {/* Wide halo burst */}
        <path d="M256,92 L267,137 L312,148 L267,159 L256,204 L245,159 L200,148 L245,137 Z"
              style={{ fill: 'url(#lm-gold)', opacity: 0.40 }} />
        {/* Main star */}
        <path d="M256,108 L267,137 L296,148 L267,159 L256,188 L245,159 L216,148 L245,137 Z"
              style={{ fill: 'url(#lm-gold)' }} />
        {/* Bright center */}
        <circle cx="256" cy="148" r="6" style={{ fill: 'white' }} />
      </g>
    </svg>
  );
}
