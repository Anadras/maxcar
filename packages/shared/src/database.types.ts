export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      advertisers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          document_number: string | null
          id: string
          legal_name: string
          status: Database["public"]["Enums"]["advertiser_status"]
          trade_name: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          document_number?: string | null
          id?: string
          legal_name: string
          status?: Database["public"]["Enums"]["advertiser_status"]
          trade_name: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          document_number?: string | null
          id?: string
          legal_name?: string
          status?: Database["public"]["Enums"]["advertiser_status"]
          trade_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_remote_config: {
        Row: {
          config_version: number
          heartbeat_interval_seconds: number
          id: boolean
          kiosk_enabled: boolean
          logging_level: string
          sync_interval_seconds: number
          updated_at: string
        }
        Insert: {
          config_version?: number
          heartbeat_interval_seconds?: number
          id?: boolean
          kiosk_enabled?: boolean
          logging_level?: string
          sync_interval_seconds?: number
          updated_at?: string
        }
        Update: {
          config_version?: number
          heartbeat_interval_seconds?: number
          id?: boolean
          kiosk_enabled?: boolean
          logging_level?: string
          sync_interval_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_role: Database["public"]["Enums"]["app_role"]
          actor_user_id: string | null
          before_snapshot: Json | null
          created_at: string
          entity_id: string
          entity_label: string
          entity_type: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          action: string
          actor_role: Database["public"]["Enums"]["app_role"]
          actor_user_id?: string | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id: string
          entity_label: string
          entity_type: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          action?: string
          actor_role?: Database["public"]["Enums"]["app_role"]
          actor_user_id?: string | null
          before_snapshot?: Json | null
          created_at?: string
          entity_id?: string
          entity_label?: string
          entity_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          pilot_mode: boolean
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          pilot_mode?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          pilot_mode?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      campaign_creatives: {
        Row: {
          active: boolean
          campaign_id: string
          checksum: string
          created_at: string
          creative_type: Database["public"]["Enums"]["creative_type"]
          duration_seconds: number
          file_size_bytes: number | null
          id: string
          name: string
          storage_path: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_id: string
          checksum: string
          created_at?: string
          creative_type: Database["public"]["Enums"]["creative_type"]
          duration_seconds: number
          file_size_bytes?: number | null
          id?: string
          name: string
          storage_path: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_id?: string
          checksum?: string
          created_at?: string
          creative_type?: Database["public"]["Enums"]["creative_type"]
          duration_seconds?: number
          file_size_bytes?: number | null
          id?: string
          name?: string
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_creatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_geofences: {
        Row: {
          active: boolean
          campaign_id: string
          cooldown_override_seconds: number | null
          created_at: string
          establishment_id: string
          id: string
          priority_override: number | null
          radius_meters: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_id: string
          cooldown_override_seconds?: number | null
          created_at?: string
          establishment_id: string
          id?: string
          priority_override?: number | null
          radius_meters: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_id?: string
          cooldown_override_seconds?: number | null
          created_at?: string
          establishment_id?: string
          id?: string
          priority_override?: number | null
          radius_meters?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_geofences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishment_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_days: number[]
          advertiser_id: string
          campaign_type: Database["public"]["Enums"]["campaign_type"]
          cooldown_seconds: number
          created_at: string
          daily_end_time: string | null
          daily_start_time: string | null
          ends_at: string | null
          id: string
          max_daily_impressions: number | null
          name: string
          priority: number
          starts_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          updated_at: string
        }
        Insert: {
          active_days?: number[]
          advertiser_id: string
          campaign_type: Database["public"]["Enums"]["campaign_type"]
          cooldown_seconds?: number
          created_at?: string
          daily_end_time?: string | null
          daily_start_time?: string | null
          ends_at?: string | null
          id?: string
          max_daily_impressions?: number | null
          name: string
          priority?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Update: {
          active_days?: number[]
          advertiser_id?: string
          campaign_type?: Database["public"]["Enums"]["campaign_type"]
          cooldown_seconds?: number
          created_at?: string
          daily_end_time?: string | null
          daily_start_time?: string | null
          ends_at?: string | null
          id?: string
          max_daily_impressions?: number | null
          name?: string
          priority?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      device_commands: {
        Row: {
          command_type: Database["public"]["Enums"]["device_command_type"]
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          device_id: string
          expires_at: string
          id: string
          issued_by: string | null
          result: string | null
          status: Database["public"]["Enums"]["device_command_status"]
        }
        Insert: {
          command_type: Database["public"]["Enums"]["device_command_type"]
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id: string
          expires_at?: string
          id?: string
          issued_by?: string | null
          result?: string | null
          status?: Database["public"]["Enums"]["device_command_status"]
        }
        Update: {
          command_type?: Database["public"]["Enums"]["device_command_type"]
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          device_id?: string
          expires_at?: string
          id?: string
          issued_by?: string | null
          result?: string | null
          status?: Database["public"]["Enums"]["device_command_status"]
        }
        Relationships: [
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
        ]
      }
      device_credentials: {
        Row: {
          created_at: string
          device_id: string
          id: string
          installation_id: string | null
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          installation_id?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          installation_id?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
        ]
      }
      device_enrollment_attempts: {
        Row: {
          id: number
          installation_id: string
          occurred_at: string
          succeeded: boolean
        }
        Insert: {
          id?: never
          installation_id: string
          occurred_at?: string
          succeeded: boolean
        }
        Update: {
          id?: never
          installation_id?: string
          occurred_at?: string
          succeeded?: boolean
        }
        Relationships: []
      }
      device_enrollment_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          created_by: string | null
          device_id: string
          expires_at: string
          id: string
          max_attempts: number
          revoked_at: string | null
          used_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          created_by?: string | null
          device_id: string
          expires_at: string
          id?: string
          max_attempts?: number
          revoked_at?: string | null
          used_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          created_by?: string | null
          device_id?: string
          expires_at?: string
          id?: string
          max_attempts?: number
          revoked_at?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_enrollment_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_enrollment_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_enrollment_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_enrollment_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_enrollment_codes_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          app_version: string | null
          battery_level: number | null
          client_event_id: string | null
          clock_skew_seconds: number | null
          created_at: string
          current_campaign_id: string | null
          current_creative_id: string | null
          device_id: string
          gps_available: boolean
          id: string
          kiosk_level: string | null
          last_error: string | null
          last_geo_campaign_id: string | null
          last_geofence_entry_at: string | null
          last_location_error: string | null
          location: unknown
          location_accuracy_meters: number | null
          location_permission_granted: boolean | null
          manifest_version: string | null
          media_ready_count: number | null
          network_connected: boolean
          operational_status: string | null
          pending_event_count: number | null
          player_state: string | null
          recorded_at: string
          storage_free_bytes: number | null
        }
        Insert: {
          app_version?: string | null
          battery_level?: number | null
          client_event_id?: string | null
          clock_skew_seconds?: number | null
          created_at?: string
          current_campaign_id?: string | null
          current_creative_id?: string | null
          device_id: string
          gps_available: boolean
          id?: string
          kiosk_level?: string | null
          last_error?: string | null
          last_geo_campaign_id?: string | null
          last_geofence_entry_at?: string | null
          last_location_error?: string | null
          location?: unknown
          location_accuracy_meters?: number | null
          location_permission_granted?: boolean | null
          manifest_version?: string | null
          media_ready_count?: number | null
          network_connected: boolean
          operational_status?: string | null
          pending_event_count?: number | null
          player_state?: string | null
          recorded_at: string
          storage_free_bytes?: number | null
        }
        Update: {
          app_version?: string | null
          battery_level?: number | null
          client_event_id?: string | null
          clock_skew_seconds?: number | null
          created_at?: string
          current_campaign_id?: string | null
          current_creative_id?: string | null
          device_id?: string
          gps_available?: boolean
          id?: string
          kiosk_level?: string | null
          last_error?: string | null
          last_geo_campaign_id?: string | null
          last_geofence_entry_at?: string | null
          last_location_error?: string | null
          location?: unknown
          location_accuracy_meters?: number | null
          location_permission_granted?: boolean | null
          manifest_version?: string | null
          media_ready_count?: number | null
          network_connected?: boolean
          operational_status?: string | null
          pending_event_count?: number | null
          player_state?: string | null
          recorded_at?: string
          storage_free_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_current_campaign_id_fkey"
            columns: ["current_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_current_campaign_id_fkey"
            columns: ["current_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_current_creative_id_fkey"
            columns: ["current_creative_id"]
            isOneToOne: false
            referencedRelation: "campaign_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_heartbeats_last_geo_campaign_id_fkey"
            columns: ["last_geo_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_last_geo_campaign_id_fkey"
            columns: ["last_geo_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string | null
          archived_at: string | null
          created_at: string
          device_code: string
          id: string
          last_seen_at: string | null
          last_sync_at: string | null
          maintenance_pin_hash: string | null
          maintenance_pin_salt: string | null
          status: Database["public"]["Enums"]["device_status"]
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          app_version?: string | null
          archived_at?: string | null
          created_at?: string
          device_code: string
          id?: string
          last_seen_at?: string | null
          last_sync_at?: string | null
          maintenance_pin_hash?: string | null
          maintenance_pin_salt?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          app_version?: string | null
          archived_at?: string | null
          created_at?: string
          device_code?: string
          id?: string
          last_seen_at?: string | null
          last_sync_at?: string | null
          maintenance_pin_hash?: string | null
          maintenance_pin_salt?: string | null
          status?: Database["public"]["Enums"]["device_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_sessions: {
        Row: {
          created_at: string
          device_id: string | null
          driver_id: string
          ended_at: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["driver_session_status"]
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          driver_id: string
          ended_at?: string | null
          id?: string
          started_at: string
          status?: Database["public"]["Enums"]["driver_session_status"]
          vehicle_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          driver_id?: string
          ended_at?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["driver_session_status"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "driver_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "driver_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_sessions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "driver_sessions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_sessions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          archived_at: string | null
          created_at: string
          document_number: string | null
          email: string | null
          full_name: string
          id: string
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          document_number?: string | null
          email?: string | null
          full_name: string
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          document_number?: string | null
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
        }
        Relationships: []
      }
      establishments: {
        Row: {
          active: boolean
          address_line: string
          advertiser_id: string
          city: string
          complement: string | null
          created_at: string
          id: string
          location: unknown
          name: string
          neighborhood: string | null
          number: string | null
          postal_code: string | null
          state: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address_line: string
          advertiser_id: string
          city: string
          complement?: string | null
          created_at?: string
          id?: string
          location: unknown
          name: string
          neighborhood?: string | null
          number?: string | null
          postal_code?: string | null
          state: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address_line?: string
          advertiser_id?: string
          city?: string
          complement?: string | null
          created_at?: string
          id?: string
          location?: unknown
          name?: string
          neighborhood?: string | null
          number?: string | null
          postal_code?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishments_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          accuracy_meters: number | null
          campaign_geofence_id: string
          client_event_id: string | null
          created_at: string
          device_id: string
          distance_meters: number | null
          event_type: Database["public"]["Enums"]["geofence_event_type"]
          id: string
          location: unknown
          occurred_at: string
        }
        Insert: {
          accuracy_meters?: number | null
          campaign_geofence_id: string
          client_event_id?: string | null
          created_at?: string
          device_id: string
          distance_meters?: number | null
          event_type: Database["public"]["Enums"]["geofence_event_type"]
          id?: string
          location: unknown
          occurred_at: string
        }
        Update: {
          accuracy_meters?: number | null
          campaign_geofence_id?: string
          client_event_id?: string | null
          created_at?: string
          device_id?: string
          distance_meters?: number | null
          event_type?: Database["public"]["Enums"]["geofence_event_type"]
          id?: string
          location?: unknown
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_campaign_geofence_id_fkey"
            columns: ["campaign_geofence_id"]
            isOneToOne: false
            referencedRelation: "campaign_geofence_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_campaign_geofence_id_fkey"
            columns: ["campaign_geofence_id"]
            isOneToOne: false
            referencedRelation: "campaign_geofences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "geofence_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
        ]
      }
      impressions: {
        Row: {
          campaign_id: string
          client_event_id: string
          completed_at: string | null
          completion_percentage: number | null
          created_at: string
          creative_id: string | null
          device_id: string
          distance_from_establishment_meters: number | null
          duration_ms: number | null
          failure_reason: string | null
          id: string
          location: unknown
          offline_generated: boolean
          source: Database["public"]["Enums"]["impression_source"]
          started_at: string
          status: Database["public"]["Enums"]["impression_status"]
          vehicle_id: string | null
        }
        Insert: {
          campaign_id: string
          client_event_id: string
          completed_at?: string | null
          completion_percentage?: number | null
          created_at?: string
          creative_id?: string | null
          device_id: string
          distance_from_establishment_meters?: number | null
          duration_ms?: number | null
          failure_reason?: string | null
          id?: string
          location?: unknown
          offline_generated?: boolean
          source: Database["public"]["Enums"]["impression_source"]
          started_at: string
          status: Database["public"]["Enums"]["impression_status"]
          vehicle_id?: string | null
        }
        Update: {
          campaign_id?: string
          client_event_id?: string
          completed_at?: string | null
          completion_percentage?: number | null
          created_at?: string
          creative_id?: string | null
          device_id?: string
          distance_from_establishment_meters?: number | null
          duration_ms?: number | null
          failure_reason?: string | null
          id?: string
          location?: unknown
          offline_generated?: boolean
          source?: Database["public"]["Enums"]["impression_source"]
          started_at?: string
          status?: Database["public"]["Enums"]["impression_status"]
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impressions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_creative_id_fkey"
            columns: ["creative_id"]
            isOneToOne: false
            referencedRelation: "campaign_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "impressions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "impressions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "impressions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impressions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_items: {
        Row: {
          active: boolean
          campaign_id: string
          created_at: string
          id: string
          playlist_id: string
          position: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign_id: string
          created_at?: string
          id?: string
          playlist_id: string
          position: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign_id?: string
          created_at?: string
          id?: string
          playlist_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_items_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          active: boolean
          created_at: string
          device_id: string | null
          ends_at: string | null
          id: string
          name: string
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_id?: string | null
          ends_at?: string | null
          id?: string
          name: string
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          device_id?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          advertiser_id: string | null
          created_at: string
          driver_id: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          advertiser_id?: string | null
          created_at?: string
          driver_id?: string | null
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          advertiser_id?: string | null
          created_at?: string
          driver_id?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "profiles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          archived_at: string | null
          created_at: string
          driver_id: string | null
          id: string
          internal_code: string
          license_plate: string | null
          make: string | null
          model: string | null
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
          year: number | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          internal_code: string
          license_plate?: string | null
          make?: string | null
          model?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          year?: number | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          internal_code?: string
          license_plate?: string | null
          make?: string | null
          model?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaign_admin_view: {
        Row: {
          active_days: number[] | null
          advertiser_id: string | null
          advertiser_name: string | null
          campaign_type: Database["public"]["Enums"]["campaign_type"] | null
          cooldown_seconds: number | null
          created_at: string | null
          creative_count: number | null
          daily_end_time: string | null
          daily_start_time: string | null
          ends_at: string | null
          geofence_count: number | null
          id: string | null
          impression_count: number | null
          max_daily_impressions: number | null
          name: string | null
          priority: number | null
          starts_at: string | null
          status: Database["public"]["Enums"]["campaign_status"] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_geofence_admin_view: {
        Row: {
          active: boolean | null
          advertiser_id: string | null
          advertiser_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          city: string | null
          cooldown_override_seconds: number | null
          created_at: string | null
          establishment_id: string | null
          establishment_name: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          priority_override: number | null
          radius_meters: number | null
          state: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_geofences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishment_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_geofences_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      device_enrollment_admin_view: {
        Row: {
          credential_issued_at: string | null
          credential_last_used_at: string | null
          device_code: string | null
          device_id: string | null
          is_enrolled: boolean | null
          last_enrollment_requested_at: string | null
          pending_code_expires_at: string | null
        }
        Insert: {
          credential_issued_at?: never
          credential_last_used_at?: never
          device_code?: string | null
          device_id?: string | null
          is_enrolled?: never
          last_enrollment_requested_at?: never
          pending_code_expires_at?: never
        }
        Update: {
          credential_issued_at?: never
          credential_last_used_at?: never
          device_code?: string | null
          device_id?: string | null
          is_enrolled?: never
          last_enrollment_requested_at?: never
          pending_code_expires_at?: never
        }
        Relationships: []
      }
      device_latest_heartbeat_view: {
        Row: {
          app_version: string | null
          battery_level: number | null
          current_campaign_id: string | null
          current_creative_id: string | null
          device_id: string | null
          gps_available: boolean | null
          last_error: string | null
          last_geo_campaign_id: string | null
          last_geofence_entry_at: string | null
          last_latitude: number | null
          last_location_error: string | null
          last_longitude: number | null
          location_accuracy_meters: number | null
          location_permission_granted: boolean | null
          manifest_version: string | null
          media_ready_count: number | null
          network_connected: boolean | null
          player_state: string | null
          recorded_at: string | null
          storage_free_bytes: number | null
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_current_campaign_id_fkey"
            columns: ["current_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_current_campaign_id_fkey"
            columns: ["current_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_current_creative_id_fkey"
            columns: ["current_creative_id"]
            isOneToOne: false
            referencedRelation: "campaign_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_enrollment_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "device_heartbeats_last_geo_campaign_id_fkey"
            columns: ["last_geo_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_last_geo_campaign_id_fkey"
            columns: ["last_geo_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      device_monitoring_view: {
        Row: {
          app_version: string | null
          battery_level: number | null
          created_at: string | null
          device_code: string | null
          driver_id: string | null
          driver_name: string | null
          gps_available: boolean | null
          heartbeat_app_version: string | null
          heartbeat_at: string | null
          id: string | null
          last_seen_at: string | null
          last_sync_at: string | null
          latitude: number | null
          license_plate: string | null
          longitude: number | null
          network_connected: boolean | null
          status: Database["public"]["Enums"]["device_status"] | null
          storage_free_bytes: number | null
          updated_at: string | null
          vehicle_code: string | null
          vehicle_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_admin_view: {
        Row: {
          created_at: string | null
          document_number: string | null
          email: string | null
          full_name: string | null
          id: string | null
          license_plate: string | null
          phone: string | null
          status: Database["public"]["Enums"]["driver_status"] | null
          updated_at: string | null
          vehicle_code: string | null
          vehicle_id: string | null
        }
        Relationships: []
      }
      establishment_admin_view: {
        Row: {
          active: boolean | null
          address_line: string | null
          advertiser_id: string | null
          advertiser_name: string | null
          city: string | null
          complement: string | null
          created_at: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          name: string | null
          neighborhood: string | null
          number: string | null
          postal_code: string | null
          state: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "establishments_advertiser_id_fkey"
            columns: ["advertiser_id"]
            isOneToOne: false
            referencedRelation: "advertisers"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_admin_view: {
        Row: {
          created_at: string | null
          device_code: string | null
          device_id: string | null
          driver_id: string | null
          driver_name: string | null
          id: string | null
          internal_code: string | null
          license_plate: string | null
          make: string | null
          model: string | null
          status: Database["public"]["Enums"]["vehicle_status"] | null
          updated_at: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "device_monitoring_view"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_admin_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acknowledge_device_command: {
        Args: {
          p_command_id: string
          p_result?: string
          p_status: Database["public"]["Enums"]["device_command_status"]
          p_token: string
        }
        Returns: undefined
      }
      archive_device: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      archive_driver: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      archive_vehicle: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      create_device_command: {
        Args: {
          p_command_type: Database["public"]["Enums"]["device_command_type"]
          p_device_id: string
        }
        Returns: string
      }
      delete_device_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_advertiser_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_campaign_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_establishment_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_driver_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      delete_vehicle_permanently: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      enroll_device: {
        Args: {
          p_android_version?: string
          p_app_version?: string
          p_code: string
          p_installation_id: string
          p_manufacturer?: string
          p_model?: string
        }
        Returns: {
          device_code: string
          device_id: string
          device_token: string
          vehicle_code: string
          vehicle_id: string
        }[]
      }
      generate_device_enrollment_code: {
        Args: { p_device_id: string }
        Returns: {
          code: string
          expires_at: string
        }[]
      }
      get_device_config: {
        Args: { p_token: string }
        Returns: {
          config_version: number
          device_code: string
          device_id: string
          heartbeat_interval_seconds: number
          kiosk_enabled: boolean
          logging_level: string
          maintenance_pin_hash: string
          maintenance_pin_salt: string
          sync_interval_seconds: number
          vehicle_code: string
          vehicle_id: string
        }[]
      }
      get_device_geo_rules: { Args: { p_token: string }; Returns: Json }
      get_device_manifest: { Args: { p_token: string }; Returns: Json }
      get_device_pending_commands: {
        Args: { p_token: string }
        Returns: {
          command_id: string
          command_type: Database["public"]["Enums"]["device_command_type"]
          created_at: string
        }[]
      }
      record_device_enrollment_attempt: {
        Args: { p_installation_id: string; p_succeeded: boolean }
        Returns: undefined
      }
      record_device_geofence_event: {
        Args: {
          p_accuracy_meters?: number
          p_campaign_geofence_id: string
          p_client_event_id?: string
          p_distance_meters?: number
          p_event_type: Database["public"]["Enums"]["geofence_event_type"]
          p_latitude: number
          p_longitude: number
          p_occurred_at?: string
          p_token: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      record_device_heartbeat: {
        Args: {
          p_app_version?: string
          p_battery_level?: number
          p_client_event_id?: string
          p_clock_skew_seconds?: number
          p_current_campaign_id?: string
          p_current_creative_id?: string
          p_device_time?: string
          p_gps_available?: boolean
          p_kiosk_level?: string
          p_last_error?: string
          p_last_geo_campaign_id?: string
          p_last_geofence_entry_at?: string
          p_last_location_error?: string
          p_latitude?: number
          p_location_accuracy_meters?: number
          p_location_permission_granted?: boolean
          p_longitude?: number
          p_manifest_version?: string
          p_media_ready_count?: number
          p_network_type?: string
          p_operational_status?: string
          p_pending_event_count?: number
          p_player_state?: string
          p_storage_free_bytes?: number
          p_token: string
        }
        Returns: {
          device_code: string
          out_device_id: string
          recorded_at: string
        }[]
      }
      record_device_playback_event: {
        Args: {
          p_campaign_id: string
          p_client_event_id?: string
          p_completed_at?: string
          p_completion_percentage?: number
          p_creative_id: string
          p_duration_ms?: number
          p_failure_reason?: string
          p_offline?: boolean
          p_started_at: string
          p_status: Database["public"]["Enums"]["impression_status"]
          p_token: string
        }
        Returns: {
          recorded: boolean
        }[]
      }
      restore_device: { Args: { p_id: string }; Returns: undefined }
      restore_driver: { Args: { p_id: string }; Returns: undefined }
      restore_vehicle: { Args: { p_id: string }; Returns: undefined }
      revoke_device_credential: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      revoke_device_enrollment_code: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      save_establishment: {
        Args: {
          p_active: boolean
          p_address_line: string
          p_advertiser_id: string
          p_city: string
          p_complement: string
          p_id: string
          p_latitude: number
          p_longitude: number
          p_name: string
          p_neighborhood: string
          p_number: string
          p_postal_code: string
          p_state: string
        }
        Returns: {
          active: boolean
          address_line: string
          advertiser_id: string
          city: string
          complement: string | null
          created_at: string
          id: string
          location: unknown
          name: string
          neighborhood: string | null
          number: string | null
          postal_code: string | null
          state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "establishments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_device_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_device_maintenance_pin: {
        Args: { p_device_id: string; p_pin: string }
        Returns: undefined
      }
      set_driver_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      set_vehicle_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: undefined
      }
      simulate_device_heartbeat: {
        Args: {
          p_app_version?: string
          p_battery_level?: number
          p_device_id: string
          p_gps_available?: boolean
          p_latitude?: number
          p_longitude?: number
          p_network_connected?: boolean
          p_storage_free_bytes?: number
        }
        Returns: string
      }
      simulate_geofence_eligibility: {
        Args: {
          p_at?: string
          p_geofence_id: string
          p_latitude: number
          p_longitude: number
          p_operational_timezone?: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          distance_meters: number
          eligible: boolean
          establishment_name: string
          geofence_id: string
          radius_meters: number
          within_radius: boolean
        }[]
      }
      unlink_device_vehicle: { Args: { p_id: string }; Returns: undefined }
      unlink_vehicle_driver: { Args: { p_id: string }; Returns: undefined }
      update_own_profile_name: {
        Args: { p_full_name: string }
        Returns: undefined
      }
    }
    Enums: {
      advertiser_status: "active" | "inactive" | "suspended"
      app_role:
        | "pending"
        | "super_admin"
        | "admin"
        | "commercial"
        | "operations"
        | "advertiser"
        | "driver"
      campaign_status:
        | "draft"
        | "scheduled"
        | "active"
        | "paused"
        | "completed"
        | "cancelled"
      campaign_type: "regular" | "geo"
      creative_type: "image" | "video"
      device_command_status:
        | "pending"
        | "delivered"
        | "completed"
        | "failed"
        | "expired"
      device_command_type:
        | "sync_now"
        | "restart_player"
        | "clear_obsolete_media"
        | "enter_maintenance"
        | "exit_maintenance"
        | "update_config"
      device_status:
        | "provisioning"
        | "online"
        | "offline"
        | "maintenance"
        | "retired"
      driver_session_status: "active" | "completed" | "cancelled"
      driver_status: "pending" | "active" | "inactive" | "suspended"
      geofence_event_type: "enter" | "exit" | "dwell"
      impression_source: "regular" | "geo"
      impression_status: "started" | "completed" | "interrupted" | "failed"
      vehicle_status:
        | "active"
        | "offline"
        | "maintenance"
        | "unassigned"
        | "retired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      advertiser_status: ["active", "inactive", "suspended"],
      app_role: [
        "pending",
        "super_admin",
        "admin",
        "commercial",
        "operations",
        "advertiser",
        "driver",
      ],
      campaign_status: [
        "draft",
        "scheduled",
        "active",
        "paused",
        "completed",
        "cancelled",
      ],
      campaign_type: ["regular", "geo"],
      creative_type: ["image", "video"],
      device_command_status: [
        "pending",
        "delivered",
        "completed",
        "failed",
        "expired",
      ],
      device_command_type: [
        "sync_now",
        "restart_player",
        "clear_obsolete_media",
        "enter_maintenance",
        "exit_maintenance",
        "update_config",
      ],
      device_status: [
        "provisioning",
        "online",
        "offline",
        "maintenance",
        "retired",
      ],
      driver_session_status: ["active", "completed", "cancelled"],
      driver_status: ["pending", "active", "inactive", "suspended"],
      geofence_event_type: ["enter", "exit", "dwell"],
      impression_source: ["regular", "geo"],
      impression_status: ["started", "completed", "interrupted", "failed"],
      vehicle_status: [
        "active",
        "offline",
        "maintenance",
        "unassigned",
        "retired",
      ],
    },
  },
} as const
