-- ─────────────────────────────────────────────────────────────────────────────
-- Store the invitee's email on the shared_access row.
--
-- The Settings page previously tried to resolve emails client-side via
-- supabase.auth.admin.getUserById, which requires the service-role key and
-- silently failed — the "Shared with" list never rendered real emails. The
-- owner already types the email when sharing, so just persist it.
-- ─────────────────────────────────────────────────────────────────────────────

alter table shared_access add column if not exists email text;

-- Backfill existing rows from auth.users (runs with sufficient privileges here).
update shared_access sa
set email = u.email
from auth.users u
where u.id = sa.shared_with_user_id
  and sa.email is null;
