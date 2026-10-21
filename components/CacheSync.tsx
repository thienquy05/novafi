'use client';
import { useEffect } from 'react';
import { installCacheInvalidation, setCacheOwner } from '@/lib/client/store';

/**
 * Mounts once inside the app shell (first, before any page content):
 *  - binds the client caches to the signed-in user (`owner`, an opaque hash) —
 *    synchronously during render so it happens before any page reads the cache;
 *  - installs the global write→invalidate guard (see lib/client/store.ts).
 * Renders nothing.
 */
export function CacheSync({ owner }: { owner: string }) {
  setCacheOwner(owner);
  useEffect(() => { installCacheInvalidation(); }, []);
  return null;
}
