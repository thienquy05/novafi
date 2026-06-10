import { describe, it, expect } from 'vitest';
import { getBankBrand } from '@/lib/bankBrands';

describe('getBankBrand', () => {
  it('matches well-known names case/punctuation-insensitively', () => {
    expect(getBankBrand('Chase')?.id).toBe('chase');
    expect(getBankBrand('chase bank')?.id).toBe('chase');
    expect(getBankBrand('Bank of America')?.id).toBe('bofa');
    expect(getBankBrand('BofA')?.id).toBe('bofa');
    expect(getBankBrand('Fifth Third Bank')?.id).toBe('fifththird');
    expect(getBankBrand('AMEX')?.id).toBe('amex');
    expect(getBankBrand('American Express')?.id).toBe('amex');
    expect(getBankBrand('Capital One')?.id).toBe('capitalone');
    expect(getBankBrand('Citibank')?.id).toBe('citi');
    expect(getBankBrand('Discover')?.id).toBe('discover');
    expect(getBankBrand('KeyBank')?.id).toBe('keybank');
    expect(getBankBrand('Huntington National Bank')?.id).toBe('huntington');
  });

  it('returns null for unknown or empty institutions', () => {
    expect(getBankBrand('My Local Credit Union')).toBeNull();
    expect(getBankBrand('')).toBeNull();
    expect(getBankBrand(undefined)).toBeNull();
    expect(getBankBrand(null)).toBeNull();
  });
});
