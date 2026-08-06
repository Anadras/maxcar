-- MAX-011 physical validation: sets the pilot's existing "teste geo"
-- geofence (6e176d97-33e0-4579-95fd-c66ab8fba7ed) to IMMEDIATE so the
-- on-device debug "Simular entrada em geofence de teste" button can be
-- used to physically verify the new interruption path on TESTE01.
-- Reversible/adjustable at any time via the geofence edit form in the
-- panel — this is pilot test configuration, not a schema change.
update public.campaign_geofences
set playback_mode_override = 'immediate'
where id = '6e176d97-33e0-4579-95fd-c66ab8fba7ed';
