-- Admin panel "Ordem de exibição" (REGULAR-only playback order). The
-- persistence mechanism already existed — playlist_items.position, set one
-- campaign at a time by publishCampaignAndSync's "append at the end"
-- logic — this only adds the missing piece: an atomic, concurrency-safe
-- way to rewrite every position at once from a drag-and-drop reorder.
--
-- Two-phase update avoids playlist_items_position_unique (playlist_id,
-- position) rejecting the swap mid-transaction: phase 1 pushes every
-- affected row's position out of the live range, phase 2 assigns the
-- final 1..N sequence from the caller's order. Requires the caller's
-- array to be exactly the current active REGULAR items for the pilot's
-- one global playlist — no partial reorders, so a stale client can never
-- silently drop a campaign from the grade.
create or replace function public.reorder_default_playlist(p_campaign_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_playlist_id uuid;
  v_current_ids uuid[];
  v_campaign_id uuid;
  v_position integer;
begin
  perform private.require_fleet_manager();

  select id into v_playlist_id
  from public.playlists
  where device_id is null and active
  limit 1;

  if v_playlist_id is null then
    raise exception using errcode = '22023', message = 'No default pilot playlist exists.';
  end if;

  select coalesce(array_agg(pi.campaign_id order by pi.position), array[]::uuid[])
  into v_current_ids
  from public.playlist_items pi
  join public.campaigns c on c.id = pi.campaign_id
  where pi.playlist_id = v_playlist_id
    and pi.active
    and c.campaign_type = 'regular';

  if p_campaign_ids is null
    or cardinality(p_campaign_ids) <> cardinality(v_current_ids)
    or (select array_agg(x order by x) from unnest(p_campaign_ids) x)
       <> (select array_agg(x order by x) from unnest(v_current_ids) x)
  then
    raise exception using errcode = '22023',
      message = 'The provided order must contain exactly the current REGULAR campaigns in the pilot grade.';
  end if;

  update public.playlist_items
  set position = position + 100000
  where playlist_id = v_playlist_id and campaign_id = any(p_campaign_ids);

  v_position := 1;
  foreach v_campaign_id in array p_campaign_ids
  loop
    update public.playlist_items
    set position = v_position
    where playlist_id = v_playlist_id and campaign_id = v_campaign_id;
    v_position := v_position + 1;
  end loop;
end;
$$;

revoke all on function public.reorder_default_playlist(uuid[]) from public, anon;
grant execute on function public.reorder_default_playlist(uuid[]) to authenticated;
