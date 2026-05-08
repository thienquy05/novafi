# NoviFi — Your Personal Finance Hub

Welcome to **NoviFi**, a simple, secure, and private personal finance tracker. 

Unlike many modern finance apps that store your financial data on their own servers, NoviFi uses **Google Sheets** as your personal database. This means you own your data completely. Every transaction, paycheck, and account balance lives directly in your own Google Drive.

## 🌟 What can NoviFi do?

NoviFi gives you a complete picture of your financial life in one place:

- **Dashboard Overview:** View your total net worth, spending trends, and upcoming bills at a glance.
- **Account Management:** Track all your checking, savings, credit cards, and investments together.
- **Transaction History:** Log your income and expenses with smart categorization and search.
- **Paycheck & Tax Tracking:** Easily log your paychecks with automatic calculations for federal, state, and retirement deductions.
- **Budgeting & Planning:** Set monthly budgets and track your progress to stay on top of your goals.
- **Automated Bills:** Keep track of recurring bills so you never miss a payment.

## 🛠️ How it Works (Under the Hood)

Though NoviFi feels like a modern web application, its backend is beautifully simple:

- **Frontend:** Built with Next.js and styled for a clean, modern look. 
- **Storage:** Instead of a traditional database, NoviFi talks directly to the Google Sheets API. When you sign in for the first time using your Google account, NoviFi automatically creates a new spreadsheet called **"NoviFi Finance Data"** in your Google Drive. 
- **Privacy First:** NoviFi only accesses the specific spreadsheet it creates. You can even open that spreadsheet in Google Sheets to view, edit, or back up your data manually at any time.

## 🚀 Quick Setup (Local Development)

If you'd like to run NoviFi on your own machine:

```bash
# 1. Clone the repository and install dependencies
git clone <your-repo-url>
cd NoviFi
npm install

# 2. Set up environment variables
cp .env.local.example .env.local
# Add your Google OAuth credentials to .env.local (see SETUP.md)

# 3. Start the application
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in. Your personal financial spreadsheet will be created immediately!

## 🌐 Deployment

Want to host NoviFi yourself so you can access it anywhere? We recommend deploying with Vercel. 
Check out our **[SETUP.md](./SETUP.md)** for a complete step-by-step guide on how to configure your Google Cloud Console and deploy the application for free.

## 📁 Your Google Sheet Structure

Curious about how your data is organized? NoviFi sets up 8 simple tabs in your spreadsheet:
- **Settings:** Tax rates, retirement percentages, etc.
- **Accounts:** Bank and investment balances.
- **Transactions:** Your everyday income and expenses.
- **Paychecks:** Detailed pay logs and tax breakdowns.
- **Budgets:** Your monthly spending limits.
- **Bills:** Upcoming recurring expenses.
- **Goals:** Savings targets.
- **NetWorthHistory:** Snapshots for your progress chart.

---
*Note: Always keep your `.env.local` file secret, as it contains the keys needed to access your Google Sheet.*
