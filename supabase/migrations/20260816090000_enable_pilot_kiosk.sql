-- MAX-011: kiosk lockdown is now actually implemented end to end (Device
-- Owner provisioning, real Lock Task enforcement via
-- setLockTaskPackages/setLockTaskFeatures, the temporary-exit-with-
-- auto-return flow). app_remote_config.kiosk_enabled has existed as a
-- fleet-wide switch since MAX-006 but stayed false because nothing
-- downstream ever used it — MainActivity.applyKioskMode only ever
-- attempts startLockTask() when this is true. Turning it on is what
-- actually activates the feature for the pilot fleet.
update public.app_remote_config
set kiosk_enabled = true, config_version = config_version + 1;
