import { useEffect } from 'react';

// Keeps a full-screen mobile overlay (the chat) usable while the on-screen keyboard is open.
//
// On iOS Safari the *layout* viewport does not shrink when the keyboard opens — only the
// *visual* viewport does, and the browser pans the page to reveal the focused field. A
// `fixed inset-0` panel therefore ends up partly behind the keyboard with its header scrolled
// away. While `active` (and on phone-width screens) this hook:
//   - publishes the visual viewport's height/offset as `--vvh` / `--vvt` on <html>, so the panel
//     can size itself to exactly the visible area (`top-[var(--vvt,0px)] h-[var(--vvh,100dvh)]`);
//   - sets `data-kb="1"` on <html> while the keyboard is up (to drop the home-indicator padding);
//   - locks page scroll behind the panel so a drag in the chat never moves the page.
// Everything is removed again on close/unmount.
export function useKeyboardViewport(active: boolean) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv || !window.matchMedia('(max-width: 767px)').matches) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
      if (window.innerHeight - vv.height > 120) root.dataset.kb = '1';
      else delete root.dataset.kb;
    };
    sync();
    root.classList.add('chat-lock');
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      root.classList.remove('chat-lock');
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vvt');
      delete root.dataset.kb;
    };
  }, [active]);
}
