import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listVehicles(search = '', status = '') {
  const supabase = await createClient();
  let query = supabase
    .from('vehicles')
    .select('*, drivers(full_name), devices(id, device_code)')
    .order('internal_code');
  const term = search.trim().replaceAll(/[,%()]/g, ' ');
  if (term) {
    query = query.or(
      `internal_code.ilike.%${term}%,license_plate.ilike.%${term}%`,
    );
  }
  if (status) {
    query = query.eq(
      'status',
      status as 'active' | 'offline' | 'maintenance' | 'unassigned' | 'retired',
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data
    .map((vehicle) => ({
      ...vehicle,
      driver_name: vehicle.drivers?.full_name ?? null,
      device_id: vehicle.devices[0]?.id ?? null,
      device_code: vehicle.devices[0]?.device_code ?? null,
    }))
    .filter(
      (vehicle) =>
        !term ||
        vehicle.internal_code.toLowerCase().includes(term.toLowerCase()) ||
        vehicle.license_plate?.toLowerCase().includes(term.toLowerCase()) ||
        vehicle.driver_name?.toLowerCase().includes(term.toLowerCase()) ||
        vehicle.device_code?.toLowerCase().includes(term.toLowerCase()),
    );
}

export async function getVehicle(id: string) {
  const supabase = await createClient();
  const [{ data, error }, { data: sessions, error: sessionError }] =
    await Promise.all([
      supabase
        .from('vehicles')
        .select('*, drivers(full_name), devices(id, device_code)')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('driver_sessions')
        .select(
          'id, started_at, ended_at, status, drivers(full_name), devices(device_code)',
        )
        .eq('vehicle_id', id)
        .order('started_at', { ascending: false })
        .limit(20),
    ]);
  if (error) throw error;
  if (sessionError) throw sessionError;
  return data
    ? {
        ...data,
        driver_name: data.drivers?.full_name ?? null,
        device_id: data.devices[0]?.id ?? null,
        device_code: data.devices[0]?.device_code ?? null,
        sessions,
      }
    : null;
}

export async function listVehicleOptions(currentVehicleId?: string | null) {
  const vehicles = await listVehicles();
  return vehicles
    .filter(
      (vehicle) =>
        vehicle.status !== 'retired' &&
        (!vehicle.device_id || vehicle.id === currentVehicleId),
    )
    .map(({ id, internal_code, license_plate, device_id }) => ({
      id,
      internal_code,
      license_plate,
      device_id,
    }));
}
