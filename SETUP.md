# NovaFi — Full Setup & Deployment Guide

This guide covers everything you need to run NovaFi locally and deploy it to **Vercel**.

---

## Do I need to create Google Sheet columns manually?

**No.** When you sign in for the first time, the app automatically:
1. Creates a Google Sheet named **"NovaFi Finance Data"** in your Google Drive
2. Creates all 8 tabs (`Settings`, `Accounts`, `Transactions`, `Paychecks`, `Budgets`, `Bills`, `Goals`, `NetWorthHistory`)
3. Seeds all header rows and default settings

You only need to set up **Google OAuth credentials** (steps below).

---

## Part 1 — Google Cloud Console Setup

### Step 1: Create a project and enable APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project** → give it a name (e.g. "NovaFi")
3. Select your new project
4. Navigate to **APIs & Services → Library**
5. Search for and enable both:
   - **Google Sheets API**
   - **Google Drive API**

### Step 2: Configure the OAuth Consent Screen

6. Go to **APIs & Services → OAuth consent screen**
7. Choose **External** (works for personal use) → click **Create**
8. Fill in:
   - App name: `NovaFi`
   - User support email: your Gmail
   - Developer contact email: your Gmail
9. Click **Save and Continue**
10. On the **Scopes** step, click **Add or Remove Scopes** and add:
    - `https://www.googleapis.com/auth/spreadsheets`
    - `https://www.googleapis.com/auth/drive.file`
11. Click **Save and Continue**
12. On the **Test Users** step, add your own Google email address
    > ⚠️ While the app is in **Testing** mode, only listed test users can sign in. This is fine for personal use. If you want others to use it, you'll need to publish the app (requires Google verification).

### Step 3: Create OAuth 2.0 Credentials

13. Go to **APIs & Services → Credentials**
14. Click **Create Credentials → OAuth 2.0 Client ID**
15. Application type: **Web application**
16. Name: `NovaFi Web`
17. Under **Authorized JavaScript origins**, add:
    - `http://localhost:3000`
    - `https://your-app.vercel.app` ← add after you know your Vercel URL
18. Under **Authorized redirect URIs**, add:
    - `http://localhost:3000/api/auth/callback/google` (local dev)
    - `https://your-app.vercel.app/api/auth/callback/google` ← add after Vercel deploy
19. Click **Create**
20. Copy the **Client ID** and **Client Secret** — you'll need them next

---

## Part 2 — Local Development

### Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
# From Google Cloud Console → Credentials
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here

# Generate a random secret: run this command and paste the output
# openssl rand -base64 32
AUTH_SECRET=your_generated_secret_here
```

### Run the app

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

---

## Part 3 — Deploy to Vercel

### Step 1: Push your code to GitHub

1. Create a new repository on [github.com](https://github.com)
2. Push your code:

```bash
git init  # if not already a git repo
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

> ⚠️ Make sure `.env.local` is **never committed**. The `.gitignore` already excludes `.env*` files.

### Step 2: Import to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up / log in (free tier is enough)
2. Click **Add New → Project**
3. Import your GitHub repository
4. Framework preset: **Next.js** (auto-detected)
5. Leave the build settings as defaults
6. **Before clicking Deploy**, expand **Environment Variables** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `GOOGLE_CLIENT_ID` | Your Google Client ID | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Your Google Client Secret | From Google Cloud Console |
| `AUTH_SECRET` | A random 32-byte base64 string | Run `openssl rand -base64 32` |
| `AUTH_URL` | `https://your-app.vercel.app` | Your Vercel deployment URL — **required for next-auth v5** |

> **Important:** For `AUTH_URL`, use your final Vercel URL. If you have a custom domain, use that instead of the `.vercel.app` URL.

7. Click **Deploy**

### Step 3: Update Google OAuth with your Vercel URL

After Vercel deploys and gives you a URL (e.g. `https://novafy-abc123.vercel.app`):

1. Go back to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials**
2. Click on your OAuth 2.0 Client ID
3. Add to **Authorized JavaScript origins**:
   - `https://your-app.vercel.app`
4. Add to **Authorized redirect URIs**:
   - `https://your-app.vercel.app/api/auth/callback/google`
5. Click **Save**
6. Also update your Vercel `AUTH_URL` environment variable with the correct URL if needed (Vercel → Project Settings → Environment Variables)

### Step 4: First Sign-In on Production

Visit your Vercel URL and sign in with Google. On first login:
- Google will ask you to grant access to Sheets and Drive
- The app automatically creates **"NovaFi Finance Data"** spreadsheet in your Google Drive
- All 8 sheet tabs are created with correct headers
- You're ready to use the app

---

## Summary: What You Need

| Requirement | Do you set it up manually? |
|-------------|---------------------------|
| Google Cloud project | Yes — one-time setup |
| Google Sheets API enabled | Yes — one click in API Library |
| Google Drive API enabled | Yes — one click in API Library |
| OAuth consent screen | Yes — fill in app name + scopes |
| OAuth credentials | Yes — copy Client ID + Secret |
| Google Sheet / columns | **No** — auto-created on first login |
| Vercel account | Yes — free tier at vercel.com |
| GitHub repo | Yes — to connect to Vercel |
| Environment variables | Yes — 4 vars in Vercel dashboard |

---

## Troubleshooting

**"Access blocked: This app's request is invalid"**
→ Your redirect URI in Google Cloud Console doesn't match. Make sure `https://your-app.vercel.app/api/auth/callback/google` is added exactly.

**"Error 403: access_denied"**
→ Your email isn't added as a Test User. Go to OAuth consent screen → Test users → add your email.

**Sign-in works but data doesn't save**
→ Check that `AUTH_URL` is set correctly in Vercel environment variables. Redeploy after changing env vars.

**Spreadsheet not auto-created**
→ Make sure both Google Sheets API and Google Drive API are enabled in your Google Cloud project.
