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
- `qrcode.react` for on-screen QR codes; `pdf-lib` + `@pdf-lib/fontkit` + `qrcode-generator` for label PDFs
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
npx supabase login                              # one-time, browser access token
npx supabase link --project-ref <ref>            # one-time, ref from dashboard URL; prompts for DB password
npx supabase migration repair --status applied 001 002   # one-time: 001+002 were hand-run, mark them done
npx supabase db push                             # apply local migrations not yet on the remote (003 onward)
```

`supabase` is not on PATH — use `npx supabase`. `db push` talks to the remote directly (no Docker needed). Version is parsed from the leading digits of the filename, so the `NNN_` names work as-is. New migration: `npx supabase migration new <name>` or just add the next `NNN_*.sql`. Migrations `001`+`002` were applied by hand via the SQL editor before the CLI workflow existed; `003` onward go through `db push`.

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

### LabelsPage (`src/pages/LabelsPage.tsx`) + `src/lib/labels/`

Select bins, configure, preview full-screen, then **Share / Save** (phones, via the Web Share sheet) or **Download** (desktop) a PDF generated in the browser with `pdf-lib`. Browser print-to-PDF is deliberately not used: it can't write spot colors or true strokes. Initial selection is seeded from the `?bin=<id>` query param (used by BinDetail's "Print Label"). Labels are drawn as PDF text/paths (no HTML string building), so there is no HTML-injection surface; only `safeColor` is applied to user-supplied colors.

Pipeline (pure except `pdf.ts` / `fonts.ts`):

- `layout.ts` — `layoutLabel(bin, w, h, layout, measurer)` returns draw primitives (stripe, text, qr, outline, cut) in inches. It is the single source of truth for both renderers. The bin name is always one line and shrinks to fit; its block is only as tall as the text, so a shrunk name gives its space back. Text and QR get fixed zones so they can't overlap: the QR gets its minimum size first, then as many description/item lines as fit; if that would leave fewer than two lines, the bin number shrinks a step at a time. `layout` is `'stack'` or `'split'` — `pickLayout(w,h)` derives it from aspect ratio.
- `jobs.ts` — `build{Home,Thermal,Wide,Custom}Pages` return `PageSpec[]` (page size + placed labels). Wide-format sheet math (`calcLabelW`, `wideRowsPerSheet`, `WIDE_SHAPES`) lives here.
- `pdf.ts` — `buildPdf(pages, fonts, opts)`, lazy-loaded. Writes real `/Separation` spot colors (cut contour + optional spot black), a stroke-only cut line (0.02"), vector QR, and text either as live Arial (a non-embedded TrueType reference to `ArialMT`/`Arial-BoldMT` with Arimo widths — Windows/macOS/iOS all ship Arial, so nothing to install) or, with the "Outline text" option, as filled glyph outlines. Saved without object streams for RIP compatibility.
- `fonts.ts` — loads Arimo (Arial-metric, 400/700) `.woff` from `@fontsource`, builds the text `Measurer` (fontkit) and registers `FontFace`s (`SSLabel*`) for the preview. Ligatures are off in both preview and PDF so measured widths match what is drawn. Only two fonts: the bin number is Arial Bold too.
- `components/labels/PageSvg.tsx` — preview renderer (SVG in inch units) built from the same layout.
- `qr.ts` — QR module matrix via `qrcode-generator` (BinDetail still uses `qrcode.react` for its on-screen QR).

**4 print modes**:

1. `home` — US Letter, 1–6 labels/page.
2. `thermal` — one label per page; presets (4×6, 6×4, 3×2, 2×3, 4×4) or custom W/H + margins.
3. `wideformat` — roll/sheet model with multi-sheet overflow and auto-fit length; label **width** from roll math, **height** locked to `WIDE_SHAPES[shape].ratio` (`qr` / `square` / `wide`). `WideFormatDiagram` shows a to-scale sketch + estimated QR scan distance.
4. `custom` — arbitrary page W/H, cols, rows, margins, gap.

**Color / spot settings**: *Cut Contour* (all modes) is a solid 0.02" stroke in a spot swatch named by `CutContourSettings.swatchName` (default `CutContour`), offset −0.1"–0.1"; its color is only the on-screen/alternate color. *Print black* (wide format only) uses spot swatch `RVW-BK22A` (editable) at 100% for all text and QR codes; other modes use plain black. The thin gray label outline always prints.

## UI primitives (`src/components/ui/`)

- `button.tsx` — CVA variants (default/destructive/outline/secondary/ghost/link), sizes (default/sm/lg/icon), `asChild` via Radix Slot.
- `primitives.tsx` — `Input`, `Textarea`, `Label`, `Card` family, `Badge`.
- `controls.tsx` — `Switch`, `Checkbox` (Radix).
- `dialog.tsx` — Radix Dialog wrapper.
- `select.tsx` — Radix Select wrapper.
- `toast.tsx` — custom `ToastProvider` + `useToast()`; `toast(message, 'success' | 'error')`, auto-dismiss 3.5s.
