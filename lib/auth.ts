import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { google as googleApis } from 'googleapis';
import { DEFAULT_TAX_SETTINGS } from './utils';
import { withRetryProxy } from './retry';

const SPREADSHEET_NAME = 'NovaFi Finance Data';

async function findOrCreateSpreadsheet(accessToken: string): Promise<string> {
  const auth = new googleApis.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  // Retry transient errors so first-login provisioning isn't lost to a blip.
  const drive = withRetryProxy(googleApis.drive({ version: 'v3', auth }));
  const sheets = withRetryProxy(googleApis.sheets({ version: 'v4', auth }));

  // Search for existing spreadsheet
  const searchRes = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id!;
  }

  // Create new spreadsheet with all required sheets
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: SPREADSHEET_NAME },
      sheets: [
        { properties: { title: 'Settings' } },
        { properties: { title: 'Accounts' } },
        { properties: { title: 'Transactions' } },
        { properties: { title: 'Paychecks' } },
        { properties: { title: 'Budgets' } },
        { properties: { title: 'Bills' } },
        { properties: { title: 'Goals' } },
        { properties: { title: 'NetWorthHistory' } },
        { properties: { title: 'Contacts' } },
        { properties: { title: 'Splits' } },
      ],
    },
  });

  const spreadsheetId = createRes.data.spreadsheetId!;

  // Seed headers for each sheet
  const ts = DEFAULT_TAX_SETTINGS;
  const defaultSettings: [string, string][] = [
    ['filing_status', ts.filingStatus],
    ['pay_periods_per_year', String(ts.payPeriodsPerYear)],
    ['k401_pct', String(ts.k401Pct)],
    ['hsa_annual', String(ts.hsaAnnual)],
    ['ira_annual', String(ts.iraAnnual)],
    ['federal_rate', String(ts.federalRate)],
    ['state_rate', String(ts.stateRate)],
    ['city_rate', String(ts.cityRate)],
    ['fica_ss_rate', String(ts.ficaSsRate)],
    ['fica_ss_wage_base', String(ts.ficaSsWageBase)],
    ['fica_medicare_rate', String(ts.ficaMedicareRate)],
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        {
          range: 'Settings!A1',
          values: [['key', 'value'], ...defaultSettings],
        },
        {
          range: 'Accounts!A1',
          values: [['id', 'name', 'type', 'institution', 'balance', 'last4', 'color', 'created_at', 'opening_balance']],
        },
        {
          range: 'Transactions!A1',
          values: [['id', 'date', 'description', 'amount', 'type', 'category', 'account', 'notes']],
        },
        {
          range: 'Paychecks!A1',
          values: [['id', 'date', 'gross_amount', 'federal_withheld', 'state_withheld', 'local_withheld', 'k401', 'hsa', 'net_amount', 'notes']],
        },
        {
          range: 'Budgets!A1',
          values: [['id', 'category', 'amount', 'period']],
        },
        {
          range: 'Bills!A1',
          values: [['id', 'name', 'amount', 'frequency', 'next_due', 'account', 'category', 'is_active', 'split_contact_id', 'split_amount']],
        },
        {
          range: 'Goals!A1',
          values: [['id', 'name', 'target_amount', 'current_amount', 'deadline', 'icon']],
        },
        {
          range: 'NetWorthHistory!A1',
          values: [['id', 'date', 'month', 'netWorth']],
        },
        {
          range: 'Contacts!A1',
          values: [['id', 'name', 'created_at']],
        },
        {
          range: 'Splits!A1',
          values: [['id', 'bill_id', 'bill_name', 'contact_id', 'contact_name', 'amount', 'category', 'account', 'date', 'settled', 'settled_date']],
        },
      ],
    },
  });

  return spreadsheetId;
}

declare module 'next-auth' {
  interface Session {
    accessToken: string;
    spreadsheetId: string;
    error?: string;
  }
}

// JWT type is extended via the Session/JWT callbacks below

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, account }: any) {
      // First sign in — store tokens and find/create spreadsheet
      if (account?.access_token) {
        token.accessToken = account.access_token as string;
        token.refreshToken = (account.refresh_token ?? '') as string;
        token.expiresAt = (account.expires_at ?? 0) as number;
        try {
          token.spreadsheetId = await findOrCreateSpreadsheet(account.access_token as string);
        } catch (e) {
          console.error('Failed to init spreadsheet:', e);
          token.error = 'SpreadsheetInitError';
        }
      }

      // Token still valid
      if (Date.now() < ((token.expiresAt as number) ?? 0) * 1000) {
        return token;
      }

      // Refresh the token
      const refreshToken = token.refreshToken as string | undefined;
      if (!refreshToken) return { ...token, error: 'RefreshTokenMissing' };
      try {
        const resp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: refreshToken,
          }),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const refreshed: any = await resp.json();
        if (!resp.ok) throw refreshed;
        return {
          ...token,
          accessToken: refreshed.access_token as string,
          expiresAt: Math.floor(Date.now() / 1000) + (refreshed.expires_in as number),
          refreshToken: (refreshed.refresh_token as string | undefined) ?? refreshToken,
        };
      } catch {
        // Clear the expired token so API routes correctly see no valid session
        return { ...token, accessToken: undefined, error: 'RefreshAccessTokenError' };
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      session.accessToken = token.accessToken as string | undefined;
      session.spreadsheetId = token.spreadsheetId as string;
      if (token.error) session.error = token.error as string;
      return session;
    },
  },
  pages: {
    signIn: '/',
  },
});
