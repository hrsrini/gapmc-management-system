# GAPMC - Goa Agricultural Produce & Livestock Marketing Board Management System

## Overview
A complete internal government management system for the Goa Agricultural Marketing Board (APMC). The application manages agricultural markets (Yards), border checkpoints, trader registration, rent/tax invoicing, market fee collection, receipts, agreements, and stock returns.

## Current State
**Status**: MVP Complete
**Last Updated**: January 26, 2026

## Tech Stack
- **Frontend**: React 18 with TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js with TypeScript
- **Storage**: PostgreSQL (Supabase) only. `DATABASE_URL` is required in `.env`; in-memory storage is disabled. GAPMC tables live in the `gapmc` schema so existing DB tables are untouched.
- **Styling**: Shadcn/UI components with custom government-style theme (Indigo/Emerald)
- **Routing**: Wouter (client-side), Express (server-side)
- **State Management**: React Context (Auth), TanStack Query (data fetching)

## Authentication
- **Hardcoded Credentials**: 
  - Username: `admin`
  - Password: `Apmc@2026`
- Auth state stored in localStorage (`gapmc_auth`)
- Protected routes redirect to login if not authenticated

## Project Structure

```
client/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx      # Main layout wrapper
│   │   │   ├── AppSidebar.tsx    # Navigation sidebar
│   │   │   └── AppHeader.tsx     # Top header with breadcrumbs
│   │   └── ui/                   # Shadcn components
│   ├── context/
│   │   └── AuthContext.tsx       # Authentication context
│   ├── data/
│   │   ├── mockData.ts           # Seed data for development
│   │   └── yards.ts              # Master data (yards, checkposts, commodities)
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── rent/
│   │   │   ├── RentInvoiceList.tsx
│   │   │   ├── RentInvoiceForm.tsx
│   │   │   └── RentReports.tsx
│   │   ├── traders/
│   │   │   ├── TraderList.tsx
│   │   │   ├── TraderForm.tsx
│   │   │   └── TraderAgreements.tsx
│   │   ├── market-fee/
│   │   │   ├── FeeCollection.tsx
│   │   │   ├── ImportExport.tsx
│   │   │   └── Returns.tsx
│   │   └── receipts/
│   │       ├── ReceiptList.tsx
│   │       ├── ReceiptForm.tsx
│   │       └── LedgerReports.tsx
│   └── App.tsx
server/
├── storage.ts                    # In-memory storage implementation
├── routes.ts                     # API route definitions
└── index.ts                      # Express server setup
shared/
└── schema.ts                     # Zod schemas and TypeScript types
```

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | Login | Authentication page |
| `/dashboard` | Dashboard | Stats, quick actions, recent activity |
| `/rent` | Invoice List | View and filter rent invoices |
| `/rent/new` | Create Invoice | Generate new rent invoice |
| `/rent/reports` | Reports | Outstanding dues, yard-wise, GST summary |
| `/traders` | Trader Directory | List and manage traders |
| `/traders/new` | Register Trader | New trader registration form |
| `/traders/agreements` | Agreements | View and manage agreements |
| `/market-fee` | Fee Collection | Market fee entries list |
| `/market-fee/entry` | Import/Export | Create import/export fee entry |
| `/market-fee/returns` | Stock Returns | Submit periodic stock returns |
| `/receipts` | Receipt List | View all receipts |
| `/receipts/new` | Create Receipt | Issue new receipt |
| `/receipts/ledger` | Ledger Reports | Various collection reports |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/traders` | Get all traders |
| POST | `/api/traders` | Create trader |
| GET | `/api/traders/:id` | Get single trader |
| PUT | `/api/traders/:id` | Update trader |
| DELETE | `/api/traders/:id` | Delete trader |
| GET | `/api/invoices` | Get all invoices |
| POST | `/api/invoices` | Create invoice |
| GET | `/api/invoices/:id` | Get single invoice |
| PUT | `/api/invoices/:id` | Update invoice |
| DELETE | `/api/invoices/:id` | Delete invoice |
| GET | `/api/receipts` | Get all receipts |
| POST | `/api/receipts` | Create receipt |
| GET | `/api/marketfees` | Get all market fees |
| POST | `/api/marketfees` | Create market fee |
| GET | `/api/agreements` | Get all agreements |
| POST | `/api/agreements` | Create agreement |
| GET | `/api/stockreturns` | Get stock returns |
| POST | `/api/stockreturns` | Submit stock return |
| GET | `/api/activity` | Get activity logs |
| GET | `/api/stats` | Dashboard statistics |

## Master Data

### Yards (8 locations)
- Margao Main Yard (MARG)
- Ponda Market Sub Yard (POND)
- Sanquelim Market Sub Yard (SANQ)
- Mapusa Market Sub Yard (MAPU)
- Curchorem Market Sub Yard (CURC)
- Canacona Market Sub Yard (CANC)
- Valpoi Market Sub Yard (VALP)
- Pernem Market Sub Yard (PERM)

### Check Posts (5 locations)
- Polem Check Post (POLM)
- Mollem Check Post (MOLM)
- Patradevi Check Post (PATR)
- Keri Check Post (KERI)
- Dodamarg Check Post (DODA)

### Receipt Types
- Rent Receipt (with GST)
- Market Fee Receipt
- License Fee Receipt
- Other Receipt

## Color Scheme
- **Primary**: Indigo (`#4f46e5`)
- **Accent**: Emerald (`#10b981`)
- **Background**: Slate-50 (`#f8fafc`)
- **Text**: Slate-900 (`#0f172a`)
- **Sidebar**: Dark Indigo with white text

## Development Notes

### Environment
- Copy `.env.example` to `.env` and set `DATABASE_URL`, `PORT`, and `NODE_ENV`.
- If `DATABASE_URL` is set, the app uses PostgreSQL (only the `gapmc` schema). Run `npm run db:push` once to create the GAPMC tables; existing database tables are not modified.

### Running the Application
```bash
npm install
npm run db:push   # only when using PostgreSQL (DATABASE_URL set)
npm run dev
```
Server starts on port 5000 with both frontend and backend.

### Key Design Decisions
1. In-memory storage for MVP simplicity (no database setup required)
2. Hardcoded authentication for internal government use
3. Government-style professional UI with indigo/emerald theme
4. Comprehensive form validation using Zod schemas
5. Seed data initialized on server start for development
6. All pages fetch data from API endpoints via React Query (no static mock data in components)
7. Error handling UI with retry buttons on all major list pages
8. Auth loading state prevents premature redirects to login

### Authentication Flow
- Login page validates credentials against hardcoded values
- Successful login stores auth state in localStorage and redirects via window.location.href
- ProtectedRoute component checks isLoading state before redirecting unauthenticated users
- AuthContext provides isAuthenticated and isLoading states to all components

### User Preferences
- GAPMC branding (no Replit references)
- Professional government aesthetic
- Responsive design for desktop and tablet use
