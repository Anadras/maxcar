import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listDrivers(search = '', status = '') {
  const supabase = await createClient();
  let query = supabase
    .from('drivers')
    .select('*, vehicles(id, internal_code, license_plate)')
    .order('full_name');
  const term = search.trim().replaceAll(/[,%()]/g, ' ');
  if (term) {
    query = query.or(
      `full_name.ilike.%${term}%,document_number.ilike.%${term}%`,
    );
  }
  if (status) {
    query = query.eq(
      'status',
      status as 'pending' | 'active' | 'inactive' | 'suspended',
    );
  }
  const { data, error } = await query;
  if (error) throw error;
  return data
    .map((driver) => ({
      ...driver,
      vehicle_id: driver.vehicles[0]?.id ?? null,
      vehicle_code: driver.vehicles[0]?.internal_code ?? null,
      license_plate: driver.vehicles[0]?.license_plate ?? null,
    }))
    .filter(
      (driver) =>
        !term ||
        driver.full_name.toLowerCase().includes(term.toLowerCase()) ||
        driver.document_number?.toLowerCase().includes(term.toLowerCase()) ||
        driver.vehicle_code?.toLowerCase().includes(term.toLowerCase()),
    );
}

export async function getDriver(id: string) {
  const supabase = await createClient();
  const [{ data, error }, { data: sessions, error: sessionError }] =
    await Promise.all([
      supabase
        .from('drivers')
        .select('*, vehicles(id, internal_code, license_plate)')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('driver_sessions')
        .select(
          'id, started_at, ended_at, status, vehicles(internal_code), devices(device_code)',
        )
        .eq('driver_id', id)
        .order('started_at', { ascending: false })
        .limit(20),
    ]);
  if (error) throw error;
  if (sessionError) throw sessionError;
  return data
    ? {
        ...data,
        vehicle_id: data.vehicles[0]?.id ?? null,
        vehicle_code: data.vehicles[0]?.internal_code ?? null,
        license_plate: data.vehicles[0]?.license_plate ?? null,
        sessions,
      }
    : null;
}

export async function listDriverOptions(currentDriverId?: string | null) {
  const drivers = await listDrivers();
  return drivers
    .filter(
      (driver) =>
        ['pending', 'active'].includes(driver.status) &&
        (!driver.vehicle_id || driver.id === currentDriverId),
    )
    .map(({ id, full_name, vehicle_id }) => ({
      id,
      full_name,
      vehicle_id,
    }));
}
