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
        {/* Deep indigo → royal blue → bright azure */}
        <linearGradient id="lm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#312E81" />
          <stop offset="45%"  stopColor="#1D4ED8" />
          <stop offset="100%" stopColor="#2E93D4" />
        </linearGradient>
        {/* Glassy top sheen */}
        <radialGradient id="lm-sheen" cx="32%" cy="14%" r="70%">
          <stop offset="0%"   stopColor="#BFE3FF" stopOpacity="0.40" />
          <stop offset="55%"  stopColor="#BFE3FF" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#BFE3FF" stopOpacity="0" />
        </radialGradient>
        {/* Rising growth ribbon */}
        <linearGradient id="lm-ribbon" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%"   stopColor="#E8F2FF" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
        {/* Golden nova */}
        <radialGradient id="lm-star" cx="50%" cy="42%" r="62%">
          <stop offset="0%"   stopColor="#FFFFFF" />
          <stop offset="28%"  stopColor="#FFF1B8" />
          <stop offset="70%"  stopColor="#F2C53D" />
          <stop offset="100%" stopColor="#D69A12" />
        </radialGradient>
        <filter id="lm-glow" x="-80%" y="-80%" width="260%" height="260%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="10" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="lm-soft" x="-20%" y="-20%" width="140%" height="150%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodColor="#0B1E45" floodOpacity="0.30" />
        </filter>
        <clipPath id="lm-clip">
          <rect x="0" y="0" width="512" height="512" rx="116" ry="116" />
        </clipPath>
      </defs>

      {/* Background */}
      <g clipPath="url(#lm-clip)">
        <rect width="512" height="512" style={{ fill: 'url(#lm-bg)' }} />
        <rect width="512" height="512" style={{ fill: 'url(#lm-sheen)' }} />
        <circle cx="392" cy="150" r="240" style={{ fill: 'none', stroke: '#FFFFFF', strokeOpacity: 0.06, strokeWidth: 2 }} />
      </g>

      {/* Ribbon rising to the nova */}
      <g clipPath="url(#lm-clip)">
        <path
          d="M104 372 C 168 360, 196 322, 238 300 C 286 274, 320 258, 388 168"
          style={{ fill: 'none', stroke: 'url(#lm-ribbon)', strokeWidth: 34, strokeLinecap: 'round', strokeLinejoin: 'round', filter: 'url(#lm-soft)' }}
        />
        <circle cx="104" cy="372" r="13" style={{ fill: '#E8F2FF' }} />
      </g>

      {/* Nova starburst */}
      <g style={{ filter: 'url(#lm-glow)' }}>
        <path
          d="M392 92 C 400 150, 404 154, 462 162 C 404 170, 400 174, 392 232 C 384 174, 380 170, 322 162 C 380 154, 384 150, 392 92 Z"
          style={{ fill: 'url(#lm-star)' }}
        />
        <circle cx="392" cy="162" r="15" style={{ fill: '#FFFFFF' }} />
      </g>
      {/* Twinkles */}
      <path d="M300 96 C 303 116, 305 118, 325 121 C 305 124, 303 126, 300 146 C 297 126, 295 124, 275 121 C 295 118, 297 116, 300 96 Z" style={{ fill: '#FFF1B8', opacity: 0.9 }} />
      <path d="M446 232 C 448 244, 449 245, 461 247 C 449 249, 448 250, 446 262 C 444 250, 443 249, 431 247 C 443 245, 444 244, 446 232 Z" style={{ fill: '#FFF1B8', opacity: 0.75 }} />
    </svg>
  );
}
