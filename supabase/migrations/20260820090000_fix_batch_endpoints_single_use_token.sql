-- MAX-013: fixes the real cause of "device-playback-events / device-
-- geofence-events always returns 401" — never a signature, grant, or
-- credential problem. private.device_id_for_token (20260812090000)
-- deliberately marks a v2 bridge session token used_at on its *first*
-- successful lookup — a genuine single-use security property, correct
-- for every endpoint that calls it exactly once per HTTP request.
--
-- device-playback-events and device-geofence-events are the two
-- exceptions: each processes a *batch* of locally-queued events in a
-- loop, calling record_device_playback_event/record_device_geofence_event
-- once per event — but both mint exactly one session token per HTTP
-- request (via resolveDeviceApiToken, once, before the loop). The first
-- event in any batch of 2+ consumes that token; every event after it
-- hits an already-used token and fails with 42501 ("Invalid or revoked
-- device credential"), which the edge function correctly-but-misleadingly
-- maps to HTTP 401 for the *entire* batch — reproduced directly against
-- a hand-seeded session token: first private.device_id_for_token() call
-- succeeds, the second with the same token raises exactly this error.
--
-- Fix: resolve device_id from the token exactly *once* per HTTP request
-- (consuming the token that one time, matching every other endpoint's
-- usage pattern), then loop using that already-resolved device_id
-- directly — never re-presenting the same token to device_id_for_token
-- a second time. New functions only; nothing in 20260803090000 or
-- 20260805090000 is edited.

create or replace function public.resolve_device_id_from_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.device_id_for_token(p_token);
end;
$$;

revoke all on function public.resolve_device_id_from_token(text) from public, anon, authenticated;
grant execute on function public.resolve_device_id_from_token(text) to service_role;

-- Same insert logic as record_device_playback_event, minus the token
-- resolution: the caller already resolved (and thereby consumed) it once
-- via resolve_device_id_from_token above.
create or replace function public.record_device_playback_event_for_device(
  p_device_id uuid,
  p_campaign_id uuid,
  p_creative_id uuid,
  p_status public.impression_status,
  p_started_at timestamptz,
  p_completed_at timestamptz default null,
  p_duration_ms integer default null,
  p_completion_percentage numeric default null,
  p_failure_reason text default null,
  p_offline boolean default false,
  p_client_event_id uuid default null
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_source public.impression_source;
  v_inserted uuid;
begin
  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'clientEventId is required.';
  end if;

  select campaign_type::text::public.impression_source into v_source
  from public.campaigns
  where id = p_campaign_id;

  if v_source is null then
    raise exception using errcode = '22023', message = 'campaignId does not reference a known campaign.';
  end if;

  select vehicle_id into v_vehicle_id from public.devices where id = p_device_id;

  insert into public.impressions (
    device_id, vehicle_id, campaign_id, creative_id, source, status,
    started_at, completed_at, duration_ms, completion_percentage,
    offline_generated, client_event_id, failure_reason
  ) values (
    p_device_id, v_vehicle_id, p_campaign_id, p_creative_id, v_source, p_status,
    p_started_at, p_completed_at, p_duration_ms, p_completion_percentage,
    coalesce(p_offline, false), p_client_event_id, p_failure_reason
  )
  on conflict (device_id, client_event_id) do nothing
  returning id into v_inserted;

  return query select v_inserted is not null;
end;
$$;

revoke all on function public.record_device_playback_event_for_device(
  uuid, uuid, uuid, public.impression_status, timestamptz, timestamptz,
  integer, numeric, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.record_device_playback_event_for_device(
  uuid, uuid, uuid, public.impression_status, timestamptz, timestamptz,
  integer, numeric, text, boolean, uuid
) to service_role;

create or replace function public.record_device_geofence_event_for_device(
  p_device_id uuid,
  p_campaign_geofence_id uuid,
  p_event_type public.geofence_event_type,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric default null,
  p_distance_meters numeric default null,
  p_occurred_at timestamptz default now(),
  p_client_event_id uuid default null
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_point extensions.geography(Point, 4326);
  v_inserted uuid;
begin
  if p_client_event_id is null then
    raise exception using errcode = '22023', message = 'clientEventId is required.';
  end if;
  if p_latitude < -90 or p_latitude > 90 then
    raise exception using errcode = '22023', message = 'Latitude must be between -90 and 90.';
  end if;
  if p_longitude < -180 or p_longitude > 180 then
    raise exception using errcode = '22023', message = 'Longitude must be between -180 and 180.';
  end if;
  if not exists (select 1 from public.campaign_geofences where id = p_campaign_geofence_id) then
    raise exception using errcode = '22023', message = 'geofenceId does not reference a known geofence.';
  end if;

  v_point := extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude), 4326
  )::extensions.geography;

  insert into public.geofence_events (
    device_id, campaign_geofence_id, event_type, occurred_at,
    location, accuracy_meters, distance_meters, client_event_id
  ) values (
    p_device_id, p_campaign_geofence_id, p_event_type, p_occurred_at,
    v_point, p_accuracy_meters, p_distance_meters, p_client_event_id
  )
  on conflict (device_id, client_event_id) where client_event_id is not null
  do nothing
  returning id into v_inserted;

  return query select v_inserted is not null;
end;
$$;

revoke all on function public.record_device_geofence_event_for_device(
  uuid, uuid, public.geofence_event_type, double precision, double precision,
  numeric, numeric, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.record_device_geofence_event_for_device(
  uuid, uuid, public.geofence_event_type, double precision, double precision,
  numeric, numeric, timestamptz, uuid
) to service_role;
