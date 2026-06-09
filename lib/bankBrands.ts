// Lightweight bank-brand recognition. We deliberately do NOT bundle the banks'
// trademarked logos; instead each known institution maps to its brand color and a
// short monogram, which `BankBadge` renders as a tinted tile. Matching is fuzzy:
// the user's free-text institution name is normalized (lowercased, non-alphanum
// stripped) and tested against a set of distinctive aliases.

export interface BankBrand {
  id: string;
  /** Canonical display label. */
  label: string;
  /** 1–2 char monogram shown on the badge. */
  short: string;
  /** Brand background color. */
  color: string;
  /** Text color on the badge (defaults to white). */
  textColor?: string;
}

const BRANDS: { brand: BankBrand; aliases: string[] }[] = [
  { brand: { id: 'chase',       label: 'Chase',            short: 'CH', color: '#117ACA' }, aliases: ['chase', 'jpmorgan', 'jpmorganchase'] },
  { brand: { id: 'amex',        label: 'American Express', short: 'AX', color: '#2671B9' }, aliases: ['amex', 'americanexpress'] },
  { brand: { id: 'huntington',  label: 'Huntington',       short: 'HU', color: '#00833E' }, aliases: ['huntington'] },
  { brand: { id: 'fifththird',  label: 'Fifth Third',      short: '53', color: '#003DA5' }, aliases: ['fifththird', 'fifththirdbank', '53bank'] },
  { brand: { id: 'bofa',        label: 'Bank of America',  short: 'BA', color: '#E31837' }, aliases: ['bankofamerica', 'bofa', 'bankamerica'] },
  { brand: { id: 'capitalone',  label: 'Capital One',      short: 'C1', color: '#004977' }, aliases: ['capitalone', 'capone'] },
  { brand: { id: 'citi',        label: 'Citibank',         short: 'CI', color: '#056DAE' }, aliases: ['citibank', 'citi', 'citigroup'] },
  { brand: { id: 'discover',    label: 'Discover',         short: 'DI', color: '#F76B1C' }, aliases: ['discover'] },
  { brand: { id: 'keybank',     label: 'KeyBank',          short: 'KE', color: '#D71E28' }, aliases: ['keybank'] },
  { brand: { id: 'wellsfargo',  label: 'Wells Fargo',      short: 'WF', color: '#D71E2B' }, aliases: ['wellsfargo', 'wellsfargobank'] },
  { brand: { id: 'usbank',      label: 'U.S. Bank',        short: 'US', color: '#0C2074' }, aliases: ['usbank', 'usbancorp'] },
  { brand: { id: 'pnc',         label: 'PNC',              short: 'PN', color: '#F58025' }, aliases: ['pnc', 'pncbank'] },
  { brand: { id: 'tdbank',      label: 'TD Bank',          short: 'TD', color: '#54B848' }, aliases: ['tdbank', 'tdbankgroup'] },
  { brand: { id: 'ally',        label: 'Ally',             short: 'AL', color: '#6E2585' }, aliases: ['allybank', 'ally'] },
  { brand: { id: 'chime',       label: 'Chime',            short: 'CM', color: '#1EC677' }, aliases: ['chime'] },
  { brand: { id: 'truist',      label: 'Truist',           short: 'TR', color: '#2D1A45' }, aliases: ['truist', 'bbt', 'suntrust'] },
  { brand: { id: 'usaa',        label: 'USAA',             short: 'UA', color: '#13294B' }, aliases: ['usaa'] },
  { brand: { id: 'navyfederal', label: 'Navy Federal',     short: 'NF', color: '#003366' }, aliases: ['navyfederal', 'navyfcu'] },
];

export function getBankBrand(institution: string | undefined | null): BankBrand | null {
  if (!institution) return null;
  const s = institution.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  for (const { brand, aliases } of BRANDS) {
    if (aliases.some((a) => s.includes(a))) return brand;
  }
  return null;
}

/** All known brands (for documentation / pickers). */
export const BANK_BRANDS = BRANDS.map((b) => b.brand);
