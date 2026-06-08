import { CONFETTI_COLORS } from '@/lib/colors';

/**
 * Dependency-free canvas confetti burst. Appends a transient full-viewport
 * canvas, rains particles for ~1.4s, then removes itself. No-ops on the server
 * and when the user prefers reduced motion.
 */
export function fireConfetti(opts: { count?: number; origin?: { x: number; y: number } } = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const count = opts.count ?? 90;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const ox = (opts.origin?.x ?? 0.5) * W;
  const oy = (opts.origin?.y ?? 0.28) * H;

  type P = {
    x: number; y: number; vx: number; vy: number;
    size: number; rot: number; vr: number; color: string; life: number;
  };
  const particles: P[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 7;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4, // bias upward so it arcs
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 0,
    };
  });

  const gravity = 0.16;
  const drag = 0.992;
  const maxLife = 90; // frames (~1.4s at 60fps)
  let frame = 0;
  let raf = 0;

  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    frame++;
    let alive = false;
    for (const p of particles) {
      p.life++;
      p.vx *= drag;
      p.vy = p.vy * drag + gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = Math.max(0, 1 - p.life / maxLife);
      if (alpha <= 0 || p.y > H + 20) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive && frame < maxLife + 10) {
      raf = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  };
  raf = requestAnimationFrame(tick);
}
