-- ─────────────────────────────────────────────────────────────────────────────
-- Fix privilege escalation via user_roles
--
-- The original "Admins can manage roles" policy was `for all using
-- (auth.uid() = user_id)`, which let any user insert/update/DELETE their own
-- role rows. Since the app treats "no viewer row" as admin, a shared viewer
-- could delete their own viewer row and flip the client UI to admin.
--
-- Roles are now server-managed only. The client keeps SELECT on its own rows.
-- Viewer role assignment follows shared_access automatically via a trigger.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the over-permissive policy. "Users can read own roles" (SELECT) stays.
drop policy if exists "Admins can manage roles" on user_roles;

-- Keep the viewer role in sync with shared_access. SECURITY DEFINER so it can
-- write user_roles rows for the shared-with user without a client-facing policy.
create or replace function sync_viewer_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into user_roles (user_id, role)
    values (new.shared_with_user_id, 'viewer')
    on conflict (user_id, role) do nothing;
    return new;
  elsif (tg_op = 'DELETE') then
    -- Only drop the viewer role once the user has no remaining shared access.
    if not exists (
      select 1 from shared_access
      where shared_with_user_id = old.shared_with_user_id
    ) then
      delete from user_roles
      where user_id = old.shared_with_user_id and role = 'viewer';
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists shared_access_sync_viewer_role on shared_access;
create trigger shared_access_sync_viewer_role
  after insert or delete on shared_access
  for each row execute procedure sync_viewer_role();

-- Backfill: ensure everyone with existing shared access has the viewer role,
-- and no one keeps a viewer role without shared access.
insert into user_roles (user_id, role)
select distinct shared_with_user_id, 'viewer'
from shared_access
on conflict (user_id, role) do nothing;

delete from user_roles ur
where ur.role = 'viewer'
  and not exists (
    select 1 from shared_access sa
    where sa.shared_with_user_id = ur.user_id
  );
