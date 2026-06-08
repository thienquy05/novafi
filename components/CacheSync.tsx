'use client';
import { useEffect } from 'react';
import { installCacheInvalidation } from '@/lib/client/store';

/**
 * Mounts once inside the app shell to install the global write→invalidate guard
 * (see lib/client/store.ts). Renders nothing.
 */
export function CacheSync() {
  useEffect(() => { installCacheInvalidation(); }, []);
  return null;
}
