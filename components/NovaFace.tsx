import type { CSSProperties } from 'react';
import { DIRECTIONS, REACTIONS, spritePosition, type Reaction } from '@/lib/mascotSprite';

// Static NovaFi mascot (the sprout bear) from the same sprite sheets as the
// dashboard's interactive NovaAvatar. `reaction` picks a face from
// nova-reactions.webp; null shows the neutral front-facing pose.
export function NovaFace({ reaction = null, size = 32, className, style }: { reaction?: Reaction | null; size?: number; className?: string; style?: CSSProperties }) {
  const sheet = reaction ? '/mascots/nova-reactions.webp' : '/mascots/nova-directions.webp';
  const index = reaction ? REACTIONS.indexOf(reaction) : DIRECTIONS.indexOf('center');
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width: size,
        height: size,
        backgroundImage: `url(${sheet})`,
        backgroundSize: '300% 300%',
        backgroundPosition: spritePosition(index),
        backgroundRepeat: 'no-repeat',
        ...style,
      }}
    />
  );
}
