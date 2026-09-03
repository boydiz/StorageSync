# StorageSync

Home storage-bin management app. Track physical bins and the items inside them, print QR-coded labels, and share a read-only view with others.

- **Live:** storagesync.boydcartwright.com
- **Deploy:** push to GitHub `main` → Vercel auto-deploys. No separate deploy step.
- **Env vars** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`): read from `import.meta.env` only. **Never put values in the repo** — they live in the Vercel dashboard. To add a new one, reference `import.meta.env.X` in code and tell the user to set the value in Vercel.
- **DB migrations:** SQL files in `supabase/migrations/` (`NNN_name.sql`). Not applied by CI. Run them with `supabase db push` (see below) or by pasting into the Supabase SQL editor. Tell the user when a change needs a migration and don't assume it's live until they confirm.

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS with CSS-variable theming; hand-rolled shadcn-style primitives in `src/components/ui/` (no `components.json`, no CLI)
- TanStack Query for all server state
- Supabase for auth + Postgres (RLS enabled on every table)
- react-router-dom v6
- `qrcode.react` for QR codes
- Path alias: `@/*` → `src/*`
- SPA routing on Vercel via `vercel.json` rewrite to `/index.html`

## Commands

```
npm run dev       # vite dev server
npm run build      # tsc && vite build
npm run preview     # preview production build
```

No test suite, no lint config, no CI beyond Vercel.

### Supabase CLI / migrations

`supabase/config.toml` is committed (`project_id = "storagesync"`). The CLI (`supabase`, installed globally) is the preferred way to apply migrations:

```
supabase login                                # one-time, browser access token
supabase link --project-ref <ref>              # one-time, ref from dashboard URL
supabase migration repair --status applied 001 002 003   # one-time, mark hand-run migrations as done
supabase db push                               # apply any local migration not yet on the remote
```

Version is parsed from the leading digits of the filename, so the `NNN_` names work as-is. New migration: `supabase migration new <name>` or just add the next `NNN_*.sql`. Migrations `001`–`003` were applied by hand via the SQL editor before the CLI workflow existed.

## Architecture

**Providers** (`src/App.tsx`): `QueryClientProvider` → `AuthProvider` → `ToastProvider` → `BrowserRouter`. Query defaults: `staleTime` 60s, `retry` 1.

**Routing:** every route except `/auth` and `/reset-password` is wrapped in `ProtectedRoute` → shows spinner while auth `loading`, redirects to `/auth` if no user, else renders inside `AppLayout`. Routes: `/` (Dashboard), `/items`, `/labels`, `/settings`, `/bin/new`, `/bin/:id`, `/bin/:id/edit`, `/item/new`, `/item/:id/edit`.

**Layout** (`src/components/layout/AppLayout.tsx`): desktop sidebar + mobile bottom nav. Admin-only floating action button for New Bin / New Item.

**Auth** (`src/contexts/AuthContext.tsx`): wraps `supabase.auth`; exposes `user`, `session`, `loading`, `signOut`. `AuthPage` does login/signup/forgot in one component via a `Mode` state. `ResetPasswordPage` handles the `PASSWORD_RECOVERY` event / magic-link session.

### Data hooks (`src/hooks/`)

All queries keyed by `user?.id` and gated with `enabled: !!user`. Each hook maps snake_case DB rows → camelCase types (`src/types/index.ts`).

- `useBins` — list; `createBin` (calls `get_next_bin_number` RPC for the per-user number), `updateBin`, `deleteBin` (cascades to items, invalidates both caches).
- `useItems` — list; CRUD + `moveItems` (bulk `bin_id` reassignment); `getItemsByBin` / `getItem` selectors.
- `useAppSettings` — one row per user; `update` mutation (partial, snake_case payload).
- `useUserRole` — queries `user_roles` for a `viewer` row. **No viewer row ⇒ admin.** `isAdmin` is the default; RLS is the real guard. Admin role is implicit — no `admin` row is ever written.
- `useDarkMode` — toggles `.dark` on `<html>`, persists to `localStorage['dark-mode']`.

### Dark mode

**On by default.** `useDarkMode` and the anti-FOUC inline script in `index.html` both treat any `localStorage['dark-mode']` value other than the string `'false'` as dark.

## Database (`supabase/migrations/001_initial_schema.sql`)

Tables: `bins`, `items`, `app_settings`, `user_roles`, `shared_access`. **RLS enabled on all.**

- Owners fully manage their own rows (`auth.uid() = user_id`).
- A `shared_access` row grants the target user **read-only** access to the owner's bins / items / settings. The row also stores the invitee's `email` (migration `003`) so the Settings list can show it without an admin API call.
- `user_roles` is **read-only from the client** (migration `002` dropped the policy that let users edit their own role). The `viewer` role is maintained server-side by the `sync_viewer_role` trigger on `shared_access` insert/delete. App still treats "no viewer row" as admin; admin is never written explicitly.
- `bins` has `unique(user_id, bin_number)`.

`SECURITY DEFINER` functions: `get_user_id_by_email`, `has_role`, `has_shared_access`, `get_next_bin_number`, `sync_viewer_role`.

Trigger `on_auth_user_created` auto-inserts an `app_settings` row on signup.

## Pages (`src/pages/`)

- **Dashboard** — combined search over bins + items.
- **ItemsPage** — all items, multi-select bulk "move to bin" dialog (admin only).
- **BinDetail** — QR code (`origin/bin/:id`), item list, delete-confirm dialog. "Print Label" navigates to `/labels?bin=<id>` (Labels page with that bin preselected).
- **BinForm / ItemForm** — create + edit. ItemForm pre-fills bin from `?binId=` query param.
- **LabelsPage** — the complex one. See below.
- **SettingsPage** — branding (app name/description + logo as data URL, 200 KB cap), dark toggle, share-by-email. `handleShare` stores the typed email on the `shared_access` row; `loadSharedUsers` reads it back directly.

### LabelsPage (`src/pages/LabelsPage.tsx`)

Select bins, configure, preview full-screen (scaled), then print by opening a Blob URL window that carries its own `@page` CSS. Initial selection is seeded from the `?bin=<id>` query param (used by BinDetail's "Print Label"). All bin/cut text is run through `escapeHtml` / `safeColor` before it goes into the concatenated print HTML — the Blob window is same-origin, so unescaped fields would be an XSS sink (migration-era fix).

**4 print modes**, each with **cut contour** support:

1. `home` — US Letter, 1–6 labels/page (preset grids; layout 3 is a side-by-side row variant).
2. `thermal` — one label per sheet; presets (4×6, 6×4, 3×2, 2×3, 4×4) or custom W/H + margins.
3. `wideformat` — roll printing; user sets roll width / labels-across / gap, label width auto-computed via `calcLabelW`; strip length capped at `maxLength`.
4. `custom` — arbitrary page W/H, cols, rows, margins, gap.

**Cut contour** (`CutContourSettings`): optional dashed rounded-rect SVG overlay drawn on top of each label, with configurable offset (−0.1"–0.1", inside/outside the label edge), color, and a spot-color / swatch name (e.g. `CutContour`, `Die Cut`) that must match the RIP software's cut layer. Rendered both as a React component (`CutContourOverlay`) for preview and as a raw SVG string (`cutContourSvgStr`) for the print HTML.

Label content sizing (stripe height, font sizes, QR fraction, padding) scales off label area — see `LabelCard` / `buildLabelHtml`, which are kept visually in sync.

## UI primitives (`src/components/ui/`)

- `button.tsx` — CVA variants (default/destructive/outline/secondary/ghost/link), sizes (default/sm/lg/icon), `asChild` via Radix Slot.
- `primitives.tsx` — `Input`, `Textarea`, `Label`, `Card` family, `Badge`.
- `controls.tsx` — `Switch`, `Checkbox` (Radix).
- `dialog.tsx` — Radix Dialog wrapper.
- `select.tsx` — Radix Select wrapper.
- `toast.tsx` — custom `ToastProvider` + `useToast()`; `toast(message, 'success' | 'error')`, auto-dismiss 3.5s.
