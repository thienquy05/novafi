'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { installCacheInvalidation, markAppHydrated, setCacheOwner } from '@/lib/client/store';

/**
 * Mounts once inside the app shell (first, before any page content):
 *  - binds the client caches to the signed-in user (`owner`, an opaque hash) —
 *    synchronously during render so it happens before any page reads the cache;
 *  - installs the global write→invalidate guard (see lib/client/store.ts);
 *  - turns on render-time cache reads (peekCache) at the first client-side
 *    navigation. Until then every page render is a hydration render of server
 *    HTML (pages hydrate in their own Suspense boundary, AFTER this shell), and
 *    cached data there would not match the server's skeleton.
 * Renders nothing.
 */
export function CacheSync({ owner }: { owner: string }) {
  setCacheOwner(owner);
  const pathname = usePathname();
  const [firstPath] = useState(pathname); // the route this page load hydrated
  // During render (idempotent), so the page rendered in this same pass already
  // gets instant cached data on the very first client-side navigation.
  if (pathname !== firstPath) markAppHydrated();
  useEffect(() => { installCacheInvalidation(); }, []);
  return null;
}
