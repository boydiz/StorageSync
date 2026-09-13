-- ─────────────────────────────────────────────────────────────────────────────
-- Fix account enumeration via get_user_id_by_email
--
-- The RPC was directly callable by any authenticated client with an arbitrary
-- email and returned a UUID (found) or null (not found) — the Settings page
-- turned that straight into a distinct "User not found with that email"
-- toast, so anyone could probe whether an email has a StorageSync account.
--
-- Lock the raw lookup down to server-side use only, and replace the client's
-- lookup-then-insert with one SECURITY DEFINER function that does both in a
-- single call, using auth.uid() as the owner (never client-supplied).
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function get_user_id_by_email(text) from public, anon, authenticated;

create or replace function share_access_by_email(_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _target_id uuid;
begin
  select id into _target_id from auth.users where email = _email;

  if _target_id is null then
    return 'not_found';
  end if;

  if _target_id = auth.uid() then
    return 'self';
  end if;

  insert into shared_access (owner_id, shared_with_user_id, email)
  values (auth.uid(), _target_id, _email)
  on conflict (owner_id, shared_with_user_id) do nothing;

  if not found then
    return 'already_shared';
  end if;

  return 'ok';
end;
$$;

grant execute on function share_access_by_email(text) to authenticated;
