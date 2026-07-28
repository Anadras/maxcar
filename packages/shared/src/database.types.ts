export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole =
  | 'pending'
  | 'super_admin'
  | 'admin'
  | 'commercial'
  | 'operations'
  | 'advertiser'
  | 'driver';

export type AdvertiserStatus = 'active' | 'inactive' | 'suspended';
export type DatabaseCampaignType = 'regular' | 'geo';
export type CampaignStatus =
  'draft' | 'scheduled' | 'active' | 'paused' | 'completed' | 'cancelled';
export type CreativeType = 'image' | 'video';

export interface Database {
  public: {
    Tables: {
      advertisers: {
        Row: {
          id: string;
          legal_name: string;
          trade_name: string;
          document_number: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          status: AdvertiserStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          legal_name: string;
          trade_name: string;
          document_number?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          status?: AdvertiserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          legal_name?: string;
          trade_name?: string;
          document_number?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_phone?: string | null;
          status?: AdvertiserStatus;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: AppRole;
          advertiser_id: string | null;
          driver_id: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: AppRole;
          advertiser_id?: string | null;
          driver_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string | null;
          role?: AppRole;
          advertiser_id?: string | null;
          driver_id?: string | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      establishments: {
        Row: {
          id: string;
          advertiser_id: string;
          name: string;
          address_line: string;
          number: string | null;
          complement: string | null;
          neighborhood: string | null;
          city: string;
          state: string;
          postal_code: string | null;
          location: unknown;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          advertiser_id: string;
          name: string;
          campaign_type: DatabaseCampaignType;
          status: CampaignStatus;
          starts_at: string | null;
          ends_at: string | null;
          daily_start_time: string | null;
          daily_end_time: string | null;
          priority: number;
          cooldown_seconds: number;
          max_daily_impressions: number | null;
          active_days: number[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          advertiser_id: string;
          name: string;
          campaign_type: DatabaseCampaignType;
          status?: CampaignStatus;
          starts_at?: string | null;
          ends_at?: string | null;
          daily_start_time?: string | null;
          daily_end_time?: string | null;
          priority?: number;
          cooldown_seconds?: number;
          max_daily_impressions?: number | null;
          active_days?: number[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          advertiser_id?: string;
          name?: string;
          campaign_type?: DatabaseCampaignType;
          status?: CampaignStatus;
          starts_at?: string | null;
          ends_at?: string | null;
          daily_start_time?: string | null;
          daily_end_time?: string | null;
          priority?: number;
          cooldown_seconds?: number;
          max_daily_impressions?: number | null;
          active_days?: number[];
          updated_at?: string;
        };
        Relationships: [];
      };
      campaign_creatives: {
        Row: {
          id: string;
          campaign_id: string;
          name: string;
          creative_type: CreativeType;
          storage_path: string;
          duration_seconds: number;
          file_size_bytes: number | null;
          checksum: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          name: string;
          creative_type: CreativeType;
          storage_path: string;
          duration_seconds: number;
          file_size_bytes?: number | null;
          checksum: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          duration_seconds?: number;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaign_geofences: {
        Row: {
          id: string;
          campaign_id: string;
          establishment_id: string;
          radius_meters: number;
          priority_override: number | null;
          cooldown_override_seconds: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          establishment_id: string;
          radius_meters: number;
          priority_override?: number | null;
          cooldown_override_seconds?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          establishment_id?: string;
          radius_meters?: number;
          priority_override?: number | null;
          cooldown_override_seconds?: number | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      establishment_admin_view: {
        Row: {
          id: string | null;
          advertiser_id: string | null;
          advertiser_name: string | null;
          name: string | null;
          address_line: string | null;
          number: string | null;
          complement: string | null;
          neighborhood: string | null;
          city: string | null;
          state: string | null;
          postal_code: string | null;
          latitude: number | null;
          longitude: number | null;
          active: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
      campaign_admin_view: {
        Row: {
          id: string | null;
          advertiser_id: string | null;
          advertiser_name: string | null;
          name: string | null;
          campaign_type: DatabaseCampaignType | null;
          status: CampaignStatus | null;
          starts_at: string | null;
          ends_at: string | null;
          daily_start_time: string | null;
          daily_end_time: string | null;
          priority: number | null;
          cooldown_seconds: number | null;
          max_daily_impressions: number | null;
          active_days: number[] | null;
          created_at: string | null;
          updated_at: string | null;
          creative_count: number | null;
          geofence_count: number | null;
          impression_count: number | null;
        };
        Relationships: [];
      };
      campaign_geofence_admin_view: {
        Row: {
          id: string | null;
          campaign_id: string | null;
          campaign_name: string | null;
          advertiser_id: string | null;
          advertiser_name: string | null;
          establishment_id: string | null;
          establishment_name: string | null;
          city: string | null;
          state: string | null;
          latitude: number | null;
          longitude: number | null;
          radius_meters: number | null;
          priority_override: number | null;
          cooldown_override_seconds: number | null;
          active: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      save_establishment: {
        Args: {
          p_id: string | null;
          p_advertiser_id: string;
          p_name: string;
          p_address_line: string;
          p_number: string;
          p_complement: string;
          p_neighborhood: string;
          p_city: string;
          p_state: string;
          p_postal_code: string;
          p_latitude: number;
          p_longitude: number;
          p_active: boolean;
        };
        Returns: Database['public']['Tables']['establishments']['Row'];
      };
      update_own_profile_name: {
        Args: { p_full_name: string };
        Returns: undefined;
      };
      simulate_geofence_eligibility: {
        Args: {
          p_geofence_id: string;
          p_latitude: number;
          p_longitude: number;
          p_at?: string;
          p_operational_timezone?: string;
        };
        Returns: Array<{
          geofence_id: string;
          campaign_id: string;
          campaign_name: string;
          establishment_name: string;
          distance_meters: number;
          radius_meters: number;
          within_radius: boolean;
          eligible: boolean;
        }>;
      };
    };
    Enums: {
      app_role: AppRole;
      advertiser_status: AdvertiserStatus;
      campaign_type: DatabaseCampaignType;
      campaign_status: CampaignStatus;
      creative_type: CreativeType;
    };
    CompositeTypes: Record<string, never>;
  };
}
