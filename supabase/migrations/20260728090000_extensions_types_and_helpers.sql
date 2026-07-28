-- MAX-002: extensions, closed domain values and reusable timestamp support.

create schema if not exists extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create type public.app_role as enum (
  'pending',
  'super_admin',
  'admin',
  'commercial',
  'operations',
  'advertiser',
  'driver'
);

create type public.advertiser_status as enum ('active', 'inactive', 'suspended');
create type public.driver_status as enum ('pending', 'active', 'inactive', 'suspended');
create type public.vehicle_status as enum ('active', 'offline', 'maintenance', 'unassigned', 'retired');
create type public.device_status as enum ('provisioning', 'online', 'offline', 'maintenance', 'retired');
create type public.campaign_type as enum ('regular', 'geo');
create type public.campaign_status as enum ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled');
create type public.creative_type as enum ('image', 'video');
create type public.geofence_event_type as enum ('enter', 'exit', 'dwell');
create type public.impression_source as enum ('regular', 'geo');
create type public.impression_status as enum ('started', 'completed', 'interrupted', 'failed');
create type public.driver_session_status as enum ('active', 'completed', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Applies a consistent transaction timestamp to mutable business records.';
