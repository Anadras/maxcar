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
    };
    Enums: {
      app_role: AppRole;
      advertiser_status: AdvertiserStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
