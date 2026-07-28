-- MAX-002: campaign inventory, media metadata, geofences and regular playlists.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertisers (id) on delete restrict,
  name text not null,
  campaign_type public.campaign_type not null,
  status public.campaign_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  daily_start_time time,
  daily_end_time time,
  priority smallint not null default 50,
  cooldown_seconds integer not null default 0,
  max_daily_impressions integer,
  active_days smallint[] not null default array[0, 1, 2, 3, 4, 5, 6]::smallint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_name_not_blank check (btrim(name) <> ''),
  constraint campaigns_period_check check (ends_at is null or starts_at is null or ends_at >= starts_at),
  constraint campaigns_priority_check check (priority between 0 and 100),
  constraint campaigns_cooldown_check check (cooldown_seconds >= 0),
  constraint campaigns_daily_limit_check check (max_daily_impressions is null or max_daily_impressions > 0),
  constraint campaigns_active_days_check check (
    cardinality(active_days) between 1 and 7
    and active_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  )
);

create index campaigns_advertiser_id_idx on public.campaigns (advertiser_id);
create index campaigns_status_idx on public.campaigns (status);
create index campaigns_campaign_type_idx on public.campaigns (campaign_type);
create index campaigns_schedule_idx on public.campaigns (starts_at, ends_at)
  where status in ('scheduled', 'active');

create table public.campaign_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  name text not null,
  creative_type public.creative_type not null,
  storage_path text not null,
  duration_seconds numeric(8, 3) not null,
  file_size_bytes bigint,
  checksum text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_creatives_name_not_blank check (btrim(name) <> ''),
  constraint campaign_creatives_storage_path_not_blank check (btrim(storage_path) <> ''),
  constraint campaign_creatives_duration_check check (duration_seconds > 0),
  constraint campaign_creatives_file_size_check check (file_size_bytes is null or file_size_bytes > 0),
  constraint campaign_creatives_checksum_not_blank check (btrim(checksum) <> '')
);

create index campaign_creatives_campaign_id_idx on public.campaign_creatives (campaign_id);
create unique index campaign_creatives_storage_path_unique on public.campaign_creatives (storage_path);

create table public.campaign_geofences (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  establishment_id uuid not null references public.establishments (id) on delete restrict,
  radius_meters integer not null,
  priority_override smallint,
  cooldown_override_seconds integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_geofences_radius_check check (radius_meters > 0 and radius_meters <= 100000),
  constraint campaign_geofences_priority_check check (priority_override is null or priority_override between 0 and 100),
  constraint campaign_geofences_cooldown_check check (cooldown_override_seconds is null or cooldown_override_seconds >= 0),
  constraint campaign_geofences_campaign_establishment_unique unique (campaign_id, establishment_id)
);

create index campaign_geofences_campaign_id_idx on public.campaign_geofences (campaign_id);
create index campaign_geofences_establishment_id_idx on public.campaign_geofences (establishment_id);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlists_name_not_blank check (btrim(name) <> ''),
  constraint playlists_period_check check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table public.playlist_items (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists (id) on delete restrict,
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  position integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlist_items_position_check check (position > 0),
  constraint playlist_items_position_unique unique (playlist_id, position),
  constraint playlist_items_campaign_unique unique (playlist_id, campaign_id)
);

create index playlist_items_campaign_id_idx on public.playlist_items (campaign_id);

create trigger campaigns_set_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();
create trigger campaign_creatives_set_updated_at before update on public.campaign_creatives
  for each row execute function public.set_updated_at();
create trigger campaign_geofences_set_updated_at before update on public.campaign_geofences
  for each row execute function public.set_updated_at();
create trigger playlists_set_updated_at before update on public.playlists
  for each row execute function public.set_updated_at();
create trigger playlist_items_set_updated_at before update on public.playlist_items
  for each row execute function public.set_updated_at();

comment on column public.campaigns.active_days is
  'Weekday set using 0=Sunday through 6=Saturday; interpreted in the operational region timezone.';
comment on column public.campaigns.daily_start_time is
  'Local wall-clock time; eligibility must apply the timezone of the operational region.';
comment on column public.campaign_creatives.storage_path is
  'Object path in the private campaign-media bucket; binaries are never stored in PostgreSQL.';
