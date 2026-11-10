// Invite-only sign-in. Only Google accounts listed in NOVAFI_ALLOWED_EMAILS
// (comma/space/newline separated, case-insensitive) may sign in or keep a
// session. Unset or empty = nobody gets in (fail closed) — the owner must list
// their own email too. Checked on every session read (lib/auth.ts jwt
// callback), so removing an email revokes access on the next request.
// ponytail: env list = redeploy to add someone; move to a store with an in-app
// approve button if access requests become frequent.

export function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: unknown, raw: string | undefined = process.env.NOVAFI_ALLOWED_EMAILS): boolean {
  if (typeof email !== 'string' || !email.trim()) return false;
  return parseAllowlist(raw).has(email.trim().toLowerCase());
}
