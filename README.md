# GAPMC Management System

**Branch: `Connected_To_DB_20260301`** — This branch connects the application to a PostgreSQL database using Drizzle ORM. All GAPMC data (traders, agreements, market fee, stock returns, rent invoices, etc.) is persisted in the `gapmc` schema.

## Prerequisites

- **Node.js** (v18+)
- **PostgreSQL** (running locally or reachable via URL)

## Setup

1. **Clone and checkout this branch**
   ```bash
   git checkout Connected_To_DB_20260301
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   - Copy `.env.example` to `.env`
   - Set `DATABASE_URL` to your PostgreSQL connection string, e.g.:
     ```env
     DATABASE_URL=postgresql://user:password@localhost:5432/your_database
     PORT=5000
     ```

4. **Create database schema**
   - Push Drizzle schema (creates/updates `gapmc.*` tables):
     ```bash
     npm run db:push
     ```
   - Optionally seed the GAPMC schema:
     ```bash
     npm run db:create-gapmc
     ```

5. **Run the app**
   ```bash
   npm run dev
   ```
   Then open the URL shown (e.g. http://localhost:5000).

6. **Sign in** — Use **email** or **username** (case-insensitive). Seeded users include usernames such as `admin`, `do`, `dv`, `da`, `readonly` (run `npm run db:seed-ioms-m10` / `db:seed-ioms-sample` after `db:push`). New installs need `db:push` so the `users.username` column exists.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server (Express + Vite) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run db:push` | Apply Drizzle schema to database |
| `npm run db:create-gapmc` | Create/seed GAPMC schema |

## Tech stack

- **Backend:** Express, Drizzle ORM, PostgreSQL (`pg`)
- **Frontend:** React, Vite, TanStack Query, Tailwind CSS
- **Auth/session:** Passport (local), express-session
