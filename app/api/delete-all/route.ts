import { NextResponse } from 'next/server';
import { deleteAllData } from '@/lib/sheets';
import { clearCache } from '@/lib/cache';
import { withSession } from '@/lib/apiRoute';

export const POST = withSession(async ({ accessToken, spreadsheetId }) => {
  await deleteAllData(accessToken, spreadsheetId);
  // Wipe the entire server-side cache so no stale data survives.
  clearCache();
  return NextResponse.json({ ok: true });
});
