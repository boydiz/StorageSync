# StorageSync

Home storage-bin management app. Track physical bins and the items inside them, print QR-coded labels, and share a read-only view with others.

- **Live:** storagesync.boydcartwright.com
- **Deploy:** push to GitHub `main` → Vercel auto-deploys. No separate deploy step.
- **Env vars** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`): read from `import.meta.env` only. **Never put values in the repo** — they live in the Vercel dashboard. To add a new one, reference `import.meta.env.X` in code and tell the user to set the value in Vercel.

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
- A `shared_access` row grants the target user **read-only** access to the owner's bins / items / settings, plus a `viewer` role in `user_roles`.
- `bins` has `unique(user_id, bin_number)`.

`SECURITY DEFINER` functions: `get_user_id_by_email`, `has_role`, `has_shared_access`, `get_next_bin_number`.

Trigger `on_auth_user_created` auto-inserts an `app_settings` row on signup.

## Pages (`src/pages/`)

- **Dashboard** — combined search over bins + items.
- **ItemsPage** — all items, multi-select bulk "move to bin" dialog (admin only).
- **BinDetail** — QR code (`origin/bin/:id`), item list, delete-confirm dialog. "Print Label" here just calls `window.print()` (prints whole page — not the polished path).
- **BinForm / ItemForm** — create + edit. ItemForm pre-fills bin from `?binId=` query param.
- **LabelsPage** — the complex one. See below.
- **SettingsPage** — branding (app name/description + logo as data URL, 200 KB cap), dark toggle, share-by-email. Note: `loadSharedUsers` calls `supabase.auth.admin.getUserById` from the browser, which needs the service-role key — so it silently falls back to showing the raw UUID instead of the email.

### LabelsPage (`src/pages/LabelsPage.tsx`)

Select bins, configure, preview full-screen (scaled), then print by opening a Blob URL window that carries its own `@page` CSS.

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
