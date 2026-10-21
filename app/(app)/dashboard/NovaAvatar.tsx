'use client';

import { useEffect, useRef } from 'react';
import { STATUS_COLOR, type HealthStatus } from '@/lib/colors';
import { Haptics } from '@/lib/haptics';
import { useTranslation } from '@/lib/i18n/context';
import { DIRECTIONS, REACTIONS, directionFor, nextTap, spritePosition, type Direction, type Reaction } from '@/lib/mascotSprite';

const DIR_URL = '/mascots/nova-directions.webp';
const REACT_URL = '/mascots/nova-reactions.webp';
const SQUASH: Keyframe[] = [
  { transform: 'scale(1,1)', easing: 'ease-in' },
  { transform: 'scale(1.10,.86)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(.95,1.08)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03,.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1,1)' },
];

export function NovaAvatar({ status, size = 52 }: { status: HealthStatus; size?: number }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const statusKey: Record<HealthStatus, string> = {
    great: 'charts.greatShape', good: 'charts.lookingGood', neutral: 'charts.setUpIncome',
    warning: 'charts.watchSpending', danger: 'charts.overBudget',
  };

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    const dir = button.querySelector<HTMLElement>('[data-layer="directions"]')!;
    const react = button.querySelector<HTMLElement>('[data-layer="reactions"]')!;
    const squashEl = button.querySelector<HTMLElement>('[data-squash]')!;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preload = new Image();
    preload.src = REACT_URL;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let glanceTimer: ReturnType<typeof setTimeout> | undefined;
    let pointer: { x: number; y: number } | null = null;
    let press: { id: number; x: number; y: number; moved: boolean; long: boolean; woke: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
    let sector = -1, sleeping = false, reaction: Reaction | null = null;
    let lastTap = 0, tapCount = 0, totalTaps = 0, lastScrollY = window.scrollY;

    const setDirection = (value: Direction) => {
      dir.style.backgroundPosition = spritePosition(DIRECTIONS.indexOf(value));
      button.dataset.direction = value;
    };
    const setReaction = (value: Reaction | null) => {
      reaction = value;
      react.style.backgroundPosition = spritePosition(REACTIONS.indexOf(value ?? 'blink'));
      react.style.opacity = value ? '1' : '0';
      dir.style.opacity = value ? '0' : '1';
      button.dataset.reaction = value ?? '';
    };
    const clearReactionTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
    const later = (ms: number, value: Reaction | null) => {
      const timer = setTimeout(() => { timers.delete(timer); setReaction(value); }, ms);
      timers.add(timer);
    };
    const squash = () => { if (!reduced.matches) squashEl.animate(SQUASH, { duration: 420 }); };
    const aim = () => {
      if (!pointer) return;
      const bounds = button.getBoundingClientRect();
      const next = directionFor(pointer.x - bounds.left - bounds.width / 2, pointer.y - bounds.top - bounds.height / 2, size * 0.42, sector);
      sector = next.sector;
      setDirection(next.direction);
    };
    const recentre = () => { pointer = null; sector = -1; setDirection('center'); };
    const doze = () => {
      if (reaction) { idleTimer = setTimeout(doze, 2000); return; }
      sleeping = true;
      setReaction('sleepy');
    };
    const poke = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(doze, 18000);
      if (!sleeping) return false;
      sleeping = false;
      clearReactionTimers();
      setReaction('surprised');
      later(550, null);
      squash();
      Haptics.light();
      return true;
    };
    const tap = () => {
      clearReactionTimers();
      const now = Date.now();
      const next = nextTap(now, lastTap, tapCount, totalTaps);
      ({ count: tapCount, total: totalTaps } = next);
      lastTap = now;
      if (next.payoff === 'dizzy') {
        setReaction('dizzy');
        later(1100, null);
        Haptics.warning();
      } else {
        setReaction('blink');
        later(120, next.payoff);
        later(560, null);
        Haptics.light();
      }
      squash();
      poke();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && press?.id !== event.pointerId) return;
      if (event.pointerType !== 'touch' && !canHover.matches) return;
      poke();
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        press.moved = true;
        clearTimeout(press.timer);
      }
      pointer = { x: event.clientX, y: event.clientY };
      aim();
    };
    const onDown = (event: PointerEvent) => {
      if (press) return;
      const woke = poke();
      const record = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, long: false, woke, timer: undefined as unknown as ReturnType<typeof setTimeout> };
      record.timer = setTimeout(() => {
        if (record.moved || record.woke) return;
        record.long = true;
        clearReactionTimers();
        setReaction('bashful');
        Haptics.medium();
      }, 500);
      press = record;
      try { button.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable */ }
    };
    const release = (event: PointerEvent, cancelled: boolean) => {
      if (!press || press.id !== event.pointerId) return;
      const record = press;
      clearTimeout(record.timer);
      press = null;
      if (event.pointerType === 'touch') recentre();
      if (record.long) { clearReactionTimers(); later(700, null); return; }
      if (!cancelled && !record.moved && !record.woke) tap();
    };
    const onUp = (event: PointerEvent) => release(event, false);
    const onCancel = (event: PointerEvent) => release(event, true);
    const onClick = (event: MouseEvent) => { if (event.detail === 0) tap(); };
    const onContext = (event: MouseEvent) => event.preventDefault();
    const onScroll = () => {
      const delta = window.scrollY - lastScrollY;
      lastScrollY = window.scrollY;
      if (pointer) { aim(); return; }
      if (Math.abs(delta) < 12 || reaction) return;
      setDirection(delta > 0 ? 'down' : 'up');
      clearTimeout(glanceTimer);
      glanceTimer = setTimeout(() => { if (!pointer) setDirection('center'); }, 700);
      poke();
    };

    setDirection('center');
    setReaction(null);
    poke();
    let idle: Animation | null = null;
    const onMotionChange = () => {
      if (reduced.matches) { idle?.cancel(); idle = null; return; }
      idle ??= button.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }],
        { duration: 3400, iterations: Infinity, easing: 'ease-in-out' },
      );
      idle.play();
    };
    onMotionChange();
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('blur', recentre);
    document.documentElement.addEventListener('mouseleave', recentre);
    button.addEventListener('pointerdown', onDown);
    button.addEventListener('pointerup', onUp);
    button.addEventListener('pointercancel', onCancel);
    button.addEventListener('click', onClick);
    button.addEventListener('contextmenu', onContext);
    reduced.addEventListener('change', onMotionChange);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', recentre);
      document.documentElement.removeEventListener('mouseleave', recentre);
      button.removeEventListener('pointerdown', onDown);
      button.removeEventListener('pointerup', onUp);
      button.removeEventListener('pointercancel', onCancel);
      button.removeEventListener('click', onClick);
      button.removeEventListener('contextmenu', onContext);
      reduced.removeEventListener('change', onMotionChange);
      clearTimeout(press?.timer);
      clearTimeout(idleTimer);
      clearTimeout(glanceTimer);
      clearReactionTimers();
      idle?.cancel();
      squashEl.getAnimations().forEach((animation) => animation.cancel());
    };
  }, [size]);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t('dashboard.novaLabel', { status: t(statusKey[status]) })}
      className="relative shrink-0 cursor-pointer select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2"
      style={{ width: size, height: size, touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
    >
      <span aria-hidden="true" className="absolute inset-0 rounded-full blur-xl" style={{ backgroundColor: STATUS_COLOR[status], opacity: 0.3 }} />
      <span data-squash aria-hidden="true" className="relative block h-full w-full" style={{ transformOrigin: '50% 78%' }}>
        <span data-layer="directions" className="pointer-events-none absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(${DIR_URL})`, backgroundSize: '300% 300%', backgroundPosition: '50% 50%' }} />
        <span data-layer="reactions" className="pointer-events-none absolute inset-0 bg-no-repeat opacity-0" style={{ backgroundImage: `url(${REACT_URL})`, backgroundSize: '300% 300%', backgroundPosition: '0% 0%' }} />
      </span>
    </button>
  );
}
