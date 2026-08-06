-- MAX-011 physical validation: TESTE01 had no maintenance PIN configured
-- yet (set_device_maintenance_pin had never been called for it), which
-- blocked physically testing the PIN-gated maintenance-exit flow and its
-- new auto-return timer. Sets one directly (same hash scheme
-- set_device_maintenance_pin uses) rather than through the RPC, since a
-- migration runs with no authenticated super_admin session to satisfy
-- that function's own role check. The PIN value itself is never recorded
-- anywhere outside this file's own local git history.
do $$
declare
  v_salt text := encode(extensions.gen_random_bytes(16), 'hex');
  v_pin text := '233086';
begin
  update public.devices
  set
    maintenance_pin_hash = encode(extensions.digest(v_pin || v_salt, 'sha256'), 'hex'),
    maintenance_pin_salt = v_salt
  where device_code = 'TESTE01';
end $$;
