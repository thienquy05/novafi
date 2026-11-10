import { describe, it, expect } from 'vitest';
import { isEmailAllowed, parseAllowlist } from '../allowlist';

describe('email allowlist', () => {
  const list = ' Owner@Gmail.com, friend@example.com;\nmom@yahoo.com ';

  it('parses comma/semicolon/newline separated, case-insensitive', () => {
    expect([...parseAllowlist(list)]).toEqual(['owner@gmail.com', 'friend@example.com', 'mom@yahoo.com']);
  });

  it('allows only listed emails', () => {
    expect(isEmailAllowed('owner@gmail.com', list)).toBe(true);
    expect(isEmailAllowed('  FRIEND@example.com ', list)).toBe(true);
    expect(isEmailAllowed('stranger@gmail.com', list)).toBe(false);
    expect(isEmailAllowed('owner@gmail.com.evil.com', list)).toBe(false);
  });

  it('fails closed when unset/empty or email missing', () => {
    expect(isEmailAllowed('owner@gmail.com', undefined)).toBe(false);
    expect(isEmailAllowed('owner@gmail.com', '')).toBe(false);
    expect(isEmailAllowed(undefined, list)).toBe(false);
    expect(isEmailAllowed('', list)).toBe(false);
  });
});
