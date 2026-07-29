-- MAX-005.5: prevent the operations panel from ever losing its last active
-- super_admin. The application already blocks this proactively, but the
-- invariant must hold regardless of which client issues the write.

create or replace function private.prevent_last_super_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' and old.active and not exists (
      select 1 from public.profiles
      where role = 'super_admin' and active and id <> old.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'At least one active super_admin is required; promote another profile first.';
    end if;
    return old;
  end if;

  if old.role = 'super_admin' and old.active
     and (new.role <> 'super_admin' or not new.active)
     and not exists (
       select 1 from public.profiles
       where role = 'super_admin' and active and id <> old.id
     ) then
    raise exception using
      errcode = '23514',
      message = 'At least one active super_admin is required; promote another profile first.';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_last_super_admin
  before update or delete on public.profiles
  for each row execute function private.prevent_last_super_admin_removal();

comment on function private.prevent_last_super_admin_removal() is
  'Blocks demoting, deactivating or deleting the only remaining active super_admin profile.';
