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
      admin_profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          restaurant_id: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          restaurant_id?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          restaurant_id?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          enabled: boolean
          endpoint: string
          id: string
          p256dh: string
          restaurant_id: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          enabled?: boolean
          endpoint: string
          id?: string
          p256dh: string
          restaurant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          enabled?: boolean
          endpoint?: string
          id?: string
          p256dh?: string
          restaurant_id?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_push_subscriptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_push_subscriptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_business_feed_state: {
        Row: {
          last_changed_at: string
          revision: number
          singleton: boolean
        }
        Insert: {
          last_changed_at?: string
          revision?: number
          singleton?: boolean
        }
        Update: {
          last_changed_at?: string
          revision?: number
          singleton?: boolean
        }
        Relationships: []
      }
      api_clients: {
        Row: {
          created_at: string
          credential_hash: string
          id: string
          last_used_at: string | null
          name: string
          rate_limit_profile: string
          scopes: string[]
          status: string
        }
        Insert: {
          created_at?: string
          credential_hash: string
          id?: string
          last_used_at?: string | null
          name: string
          rate_limit_profile?: string
          scopes?: string[]
          status?: string
        }
        Update: {
          created_at?: string
          credential_hash?: string
          id?: string
          last_used_at?: string | null
          name?: string
          rate_limit_profile?: string
          scopes?: string[]
          status?: string
        }
        Relationships: []
      }
      billing_cancellation_feedback: {
        Row: {
          created_at: string
          feedback: string | null
          id: string
          provider_subscription_id: string | null
          reason_code: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          id?: string
          provider_subscription_id?: string | null
          reason_code: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          feedback?: string | null
          id?: string
          provider_subscription_id?: string | null
          reason_code?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_cancellation_feedback_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_checkout_sessions: {
        Row: {
          created_at: string
          environment: string
          id: string
          idempotency_key: string
          provider: string
          provider_price_id: string
          provider_transaction_id: string | null
          status: string
          target_plan_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          idempotency_key: string
          provider?: string
          provider_price_id: string
          provider_transaction_id?: string | null
          status?: string
          target_plan_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          idempotency_key?: string
          provider?: string
          provider_price_id?: string
          provider_transaction_id?: string | null
          status?: string
          target_plan_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_checkout_sessions_target_plan_key_fkey"
            columns: ["target_plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "billing_checkout_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_mutations: {
        Row: {
          created_at: string
          error_code: string | null
          fingerprint: string | null
          id: string
          operation: string
          request_key: string
          result: Json
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          fingerprint?: string | null
          id?: string
          operation: string
          request_key: string
          result?: Json
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          fingerprint?: string | null
          id?: string
          operation?: string
          request_key?: string
          result?: Json
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_mutations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_provider_prices: {
        Row: {
          active: boolean
          billing_interval: string
          created_at: string
          currency: string
          environment: string
          id: string
          plan_key: string
          provider: string
          provider_price_id: string
          provider_product_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_interval?: string
          created_at?: string
          currency?: string
          environment: string
          id?: string
          plan_key: string
          provider: string
          provider_price_id: string
          provider_product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_interval?: string
          created_at?: string
          currency?: string
          environment?: string
          id?: string
          plan_key?: string
          provider?: string
          provider_price_id?: string
          provider_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_provider_prices_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          attempts: number
          error_code: string | null
          error_message: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
          provider: string
          provider_event_id: string
          provider_object_id: string | null
          received_at: string
          status: string
          workspace_id: string | null
        }
        Insert: {
          attempts?: number
          error_code?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          occurred_at: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          provider: string
          provider_event_id: string
          provider_object_id?: string | null
          received_at?: string
          status?: string
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          error_code?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          provider?: string
          provider_event_id?: string
          provider_object_id?: string | null
          received_at?: string
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dataengine_import_batches: {
        Row: {
          api_client_id: string
          approved_leads: number
          conflict_leads: number
          contract_version: string
          created_at: string
          external_batch_id: string
          id: string
          ingest_attempt_count: number
          ingest_completed_at: string | null
          ingest_lease_token: string | null
          ingest_lease_until: string | null
          ingest_phase: string
          ingest_started_at: string | null
          last_error: string | null
          last_ingest_error: string | null
          needs_data_leads: number
          published_at: string | null
          published_leads: number
          ready_leads: number
          rejected_leads: number
          request_hash: string
          reviewed_at: string | null
          source_export_id: string | null
          source_run_id: string | null
          source_scoring_version: string | null
          status: string
          summary: Json
          total_leads: number
          updated_at: string
        }
        Insert: {
          api_client_id: string
          approved_leads?: number
          conflict_leads?: number
          contract_version: string
          created_at?: string
          external_batch_id: string
          id?: string
          ingest_attempt_count?: number
          ingest_completed_at?: string | null
          ingest_lease_token?: string | null
          ingest_lease_until?: string | null
          ingest_phase?: string
          ingest_started_at?: string | null
          last_error?: string | null
          last_ingest_error?: string | null
          needs_data_leads?: number
          published_at?: string | null
          published_leads?: number
          ready_leads?: number
          rejected_leads?: number
          request_hash: string
          reviewed_at?: string | null
          source_export_id?: string | null
          source_run_id?: string | null
          source_scoring_version?: string | null
          status?: string
          summary?: Json
          total_leads?: number
          updated_at?: string
        }
        Update: {
          api_client_id?: string
          approved_leads?: number
          conflict_leads?: number
          contract_version?: string
          created_at?: string
          external_batch_id?: string
          id?: string
          ingest_attempt_count?: number
          ingest_completed_at?: string | null
          ingest_lease_token?: string | null
          ingest_lease_until?: string | null
          ingest_phase?: string
          ingest_started_at?: string | null
          last_error?: string | null
          last_ingest_error?: string | null
          needs_data_leads?: number
          published_at?: string | null
          published_leads?: number
          ready_leads?: number
          rejected_leads?: number
          request_hash?: string
          reviewed_at?: string | null
          source_export_id?: string | null
          source_run_id?: string | null
          source_scoring_version?: string | null
          status?: string
          summary?: Json
          total_leads?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataengine_import_batches_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      dataengine_import_evidence: {
        Row: {
          business_match: string | null
          confidence: string | null
          created_at: string
          extraction_method: string | null
          field: string
          id: string
          lead_id: string
          observed_at: string | null
          scope: string | null
          source_type: string | null
          source_url: string | null
          value: string
        }
        Insert: {
          business_match?: string | null
          confidence?: string | null
          created_at?: string
          extraction_method?: string | null
          field: string
          id?: string
          lead_id: string
          observed_at?: string | null
          scope?: string | null
          source_type?: string | null
          source_url?: string | null
          value: string
        }
        Update: {
          business_match?: string | null
          confidence?: string | null
          created_at?: string
          extraction_method?: string | null
          field?: string
          id?: string
          lead_id?: string
          observed_at?: string | null
          scope?: string | null
          source_type?: string | null
          source_url?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataengine_import_evidence_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "dataengine_import_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      dataengine_import_identities: {
        Row: {
          created_at: string
          first_lead_id: string
          identity_key: string
          restaurant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          first_lead_id: string
          identity_key: string
          restaurant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          first_lead_id?: string
          identity_key?: string
          restaurant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dataengine_import_identities_first_lead_id_fkey"
            columns: ["first_lead_id"]
            isOneToOne: false
            referencedRelation: "dataengine_import_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_identities_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_identities_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      dataengine_import_leads: {
        Row: {
          address: string | null
          banner_attempt_count: number
          banner_error: string | null
          banner_status: string
          batch_id: string
          business_contact_email: string | null
          business_match: string | null
          city: string | null
          claimed_conflict: boolean
          claimed_update_suggestion: Json
          conflict_reason: string | null
          created_at: string
          data_confidence: number | null
          duplicate_restaurant_id: string | null
          enrichment_status: string | null
          external_candidate_id: string
          fit_score: number | null
          id: string
          identity_claimed_at: string | null
          identity_key: string | null
          identity_status: string
          manual_override_at: string | null
          manual_override_by_user_id: string | null
          manual_override_reason: string | null
          name: string
          normalized_business_contact_email: string | null
          official_domain: string | null
          official_website_url: string | null
          official_website_verified_at: string | null
          public_banner_path: string | null
          public_banner_published_at: string | null
          public_banner_url: string | null
          publish_attempt_count: number
          publish_completed_at: string | null
          publish_error: string | null
          publish_lease_token: string | null
          publish_lease_until: string | null
          publish_phase: string
          publish_started_at: string | null
          publish_status: string
          published_at: string | null
          readiness_status: string
          restaurant_id: string | null
          restaurant_slug: string | null
          review_status: string
          reviewed_at: string | null
          source_candidate_status: string
          source_classification: string | null
          source_payload: Json
          source_place_id: string | null
          source_scoring_version: string | null
          staged_banner_content_type: string | null
          staged_banner_height: number | null
          staged_banner_path: string | null
          staged_banner_source_type: string | null
          staged_banner_source_url: string | null
          staged_banner_width: number | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          address?: string | null
          banner_attempt_count?: number
          banner_error?: string | null
          banner_status?: string
          batch_id: string
          business_contact_email?: string | null
          business_match?: string | null
          city?: string | null
          claimed_conflict?: boolean
          claimed_update_suggestion?: Json
          conflict_reason?: string | null
          created_at?: string
          data_confidence?: number | null
          duplicate_restaurant_id?: string | null
          enrichment_status?: string | null
          external_candidate_id: string
          fit_score?: number | null
          id?: string
          identity_claimed_at?: string | null
          identity_key?: string | null
          identity_status?: string
          manual_override_at?: string | null
          manual_override_by_user_id?: string | null
          manual_override_reason?: string | null
          name: string
          normalized_business_contact_email?: string | null
          official_domain?: string | null
          official_website_url?: string | null
          official_website_verified_at?: string | null
          public_banner_path?: string | null
          public_banner_published_at?: string | null
          public_banner_url?: string | null
          publish_attempt_count?: number
          publish_completed_at?: string | null
          publish_error?: string | null
          publish_lease_token?: string | null
          publish_lease_until?: string | null
          publish_phase?: string
          publish_started_at?: string | null
          publish_status?: string
          published_at?: string | null
          readiness_status?: string
          restaurant_id?: string | null
          restaurant_slug?: string | null
          review_status?: string
          reviewed_at?: string | null
          source_candidate_status?: string
          source_classification?: string | null
          source_payload?: Json
          source_place_id?: string | null
          source_scoring_version?: string | null
          staged_banner_content_type?: string | null
          staged_banner_height?: number | null
          staged_banner_path?: string | null
          staged_banner_source_type?: string | null
          staged_banner_source_url?: string | null
          staged_banner_width?: number | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          address?: string | null
          banner_attempt_count?: number
          banner_error?: string | null
          banner_status?: string
          batch_id?: string
          business_contact_email?: string | null
          business_match?: string | null
          city?: string | null
          claimed_conflict?: boolean
          claimed_update_suggestion?: Json
          conflict_reason?: string | null
          created_at?: string
          data_confidence?: number | null
          duplicate_restaurant_id?: string | null
          enrichment_status?: string | null
          external_candidate_id?: string
          fit_score?: number | null
          id?: string
          identity_claimed_at?: string | null
          identity_key?: string | null
          identity_status?: string
          manual_override_at?: string | null
          manual_override_by_user_id?: string | null
          manual_override_reason?: string | null
          name?: string
          normalized_business_contact_email?: string | null
          official_domain?: string | null
          official_website_url?: string | null
          official_website_verified_at?: string | null
          public_banner_path?: string | null
          public_banner_published_at?: string | null
          public_banner_url?: string | null
          publish_attempt_count?: number
          publish_completed_at?: string | null
          publish_error?: string | null
          publish_lease_token?: string | null
          publish_lease_until?: string | null
          publish_phase?: string
          publish_started_at?: string | null
          publish_status?: string
          published_at?: string | null
          readiness_status?: string
          restaurant_id?: string | null
          restaurant_slug?: string | null
          review_status?: string
          reviewed_at?: string | null
          source_candidate_status?: string
          source_classification?: string | null
          source_payload?: Json
          source_place_id?: string | null
          source_scoring_version?: string | null
          staged_banner_content_type?: string | null
          staged_banner_height?: number | null
          staged_banner_path?: string | null
          staged_banner_source_type?: string | null
          staged_banner_source_url?: string | null
          staged_banner_width?: number | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dataengine_import_leads_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "dataengine_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_leads_duplicate_restaurant_id_fkey"
            columns: ["duplicate_restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_leads_duplicate_restaurant_id_fkey"
            columns: ["duplicate_restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_leads_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_leads_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataengine_import_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_attempts: {
        Row: {
          attempt_number: number
          delivery_event_id: string
          error: string | null
          finished_at: string | null
          id: string
          provider_message_id: string | null
          started_at: string
          status: string
        }
        Insert: {
          attempt_number: number
          delivery_event_id: string
          error?: string | null
          finished_at?: string | null
          id?: string
          provider_message_id?: string | null
          started_at?: string
          status: string
        }
        Update: {
          attempt_number?: number
          delivery_event_id?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          provider_message_id?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_attempts_delivery_event_id_fkey"
            columns: ["delivery_event_id"]
            isOneToOne: false
            referencedRelation: "email_delivery_events"
            referencedColumns: ["id"]
          },
        ]
      }
      email_delivery_events: {
        Row: {
          attempt_count: number
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          failed_at: string | null
          id: string
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          last_provider_event_at: string | null
          lease_token: string | null
          lease_until: string | null
          max_attempts: number
          metadata: Json
          next_attempt_at: string | null
          payload: Json
          provider: string
          provider_message_id: string | null
          recipient_email: string
          reservation_id: string | null
          restaurant_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          recipient_email: string
          reservation_id?: string | null
          restaurant_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          recipient_email?: string
          reservation_id?: string | null
          restaurant_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_events_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_delivery_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbox_runs: {
        Row: {
          error_code: string | null
          failed_count: number
          finished_at: string | null
          id: string
          invocation_id: string
          processed_count: number
          retrying_count: number
          sent_count: number
          started_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          error_code?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          invocation_id: string
          processed_count?: number
          retrying_count?: number
          sent_count?: number
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Update: {
          error_code?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          invocation_id?: string
          processed_count?: number
          retrying_count?: number
          sent_count?: number
          started_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: []
      }
      email_provider_webhook_events: {
        Row: {
          event_at: string | null
          event_type: string
          payload: Json
          provider: string
          provider_event_id: string
          provider_message_id: string
          received_at: string
        }
        Insert: {
          event_at?: string | null
          event_type: string
          payload?: Json
          provider?: string
          provider_event_id: string
          provider_message_id: string
          received_at?: string
        }
        Update: {
          event_at?: string | null
          event_type?: string
          payload?: Json
          provider?: string
          provider_event_id?: string
          provider_message_id?: string
          received_at?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          created_at: string
          email_notifications: boolean
          id: string
          notification_emails: string[]
          restaurant_id: string
          sms_notifications: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          email_notifications?: boolean
          id?: string
          notification_emails?: string[]
          restaurant_id: string
          sms_notifications?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          email_notifications?: boolean
          id?: string
          notification_emails?: string[]
          restaurant_id?: string
          sms_notifications?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_settings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          features: Json
          history_days: number | null
          key: string
          monthly_price_usd_cents: number
          name: string
          reservation_limit: number | null
          restaurant_limit: number
          sort_order: number
          updated_at: string
          user_limit: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          features?: Json
          history_days?: number | null
          key: string
          monthly_price_usd_cents: number
          name: string
          reservation_limit?: number | null
          restaurant_limit: number
          sort_order: number
          updated_at?: string
          user_limit: number
        }
        Update: {
          active?: boolean
          created_at?: string
          features?: Json
          history_days?: number | null
          key?: string
          monthly_price_usd_cents?: number
          name?: string
          reservation_limit?: number | null
          restaurant_limit?: number
          sort_order?: number
          updated_at?: string
          user_limit?: number
        }
        Relationships: []
      }
      platform_audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          after_data: Json
          before_data: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_data?: Json
          before_data?: Json
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_data?: Json
          before_data?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: []
      }
      platform_members: {
        Row: {
          created_at: string
          created_by: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_restaurant_import_rows: {
        Row: {
          created_at: string
          excel_row_number: number
          failure_reason: string | null
          id: string
          import_id: string
          normalized_payload: Json
          restaurant_id: string | null
          row_status: string
          updated_at: string
          validation_messages: Json
          validation_status: string
        }
        Insert: {
          created_at?: string
          excel_row_number: number
          failure_reason?: string | null
          id?: string
          import_id: string
          normalized_payload?: Json
          restaurant_id?: string | null
          row_status?: string
          updated_at?: string
          validation_messages?: Json
          validation_status: string
        }
        Update: {
          created_at?: string
          excel_row_number?: number
          failure_reason?: string | null
          id?: string
          import_id?: string
          normalized_payload?: Json
          restaurant_id?: string | null
          row_status?: string
          updated_at?: string
          validation_messages?: Json
          validation_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_restaurant_import_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "platform_restaurant_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_restaurant_import_rows_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_restaurant_import_rows_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_restaurant_imports: {
        Row: {
          actor_user_id: string
          completed_at: string | null
          created_at: string
          created_rows: number
          failed_rows: number
          id: string
          invalid_rows: number
          mode: string
          original_filename: string
          processing_started_at: string | null
          ready_rows: number
          started_at: string
          status: string
          summary: Json
          total_rows: number
          updated_at: string
          updated_rows: number
          warning_rows: number
        }
        Insert: {
          actor_user_id: string
          completed_at?: string | null
          created_at?: string
          created_rows?: number
          failed_rows?: number
          id?: string
          invalid_rows?: number
          mode?: string
          original_filename: string
          processing_started_at?: string | null
          ready_rows?: number
          started_at?: string
          status?: string
          summary?: Json
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          warning_rows?: number
        }
        Update: {
          actor_user_id?: string
          completed_at?: string | null
          created_at?: string
          created_rows?: number
          failed_rows?: number
          id?: string
          invalid_rows?: number
          mode?: string
          original_filename?: string
          processing_started_at?: string | null
          ready_rows?: number
          started_at?: string
          status?: string
          summary?: Json
          total_rows?: number
          updated_at?: string
          updated_rows?: number
          warning_rows?: number
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      platform_user_controls: {
        Row: {
          created_at: string
          reason: string | null
          status: string
          suspended_at: string | null
          suspended_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reason?: string | null
          status?: string
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          reason?: string | null
          status?: string
          suspended_at?: string | null
          suspended_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_user_directory: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          last_sign_in_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          last_sign_in_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          last_sign_in_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      public_reservation_rate_limits: {
        Row: {
          attempt_count: number
          key_hash: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          key_hash: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          attempt_count?: number
          key_hash?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      reservation_areas: {
        Row: {
          advance_booking_days: number | null
          allowed_days_of_week: number[] | null
          blocked_dates: string[]
          closing_time: string | null
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          max_concurrent_reservations: number | null
          max_party_size: number | null
          min_advance_hours: number | null
          min_party_size: number | null
          name: string
          opening_time: string | null
          restaurant_id: string
          special_hours: Json
          time_slot_duration: number | null
          updated_at: string
        }
        Insert: {
          advance_booking_days?: number | null
          allowed_days_of_week?: number[] | null
          blocked_dates?: string[]
          closing_time?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          max_concurrent_reservations?: number | null
          max_party_size?: number | null
          min_advance_hours?: number | null
          min_party_size?: number | null
          name: string
          opening_time?: string | null
          restaurant_id: string
          special_hours?: Json
          time_slot_duration?: number | null
          updated_at?: string
        }
        Update: {
          advance_booking_days?: number | null
          allowed_days_of_week?: number[] | null
          blocked_dates?: string[]
          closing_time?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          max_concurrent_reservations?: number | null
          max_party_size?: number | null
          min_advance_hours?: number | null
          min_party_size?: number | null
          name?: string
          opening_time?: string | null
          restaurant_id?: string
          special_hours?: Json
          time_slot_duration?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_areas_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_areas_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_customer_management_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          reservation_id: string
          restaurant_id: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          reservation_id: string
          restaurant_id: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          reservation_id?: string
          restaurant_id?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_customer_management_tokens_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_customer_management_tokens_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_customer_management_tokens_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_holds: {
        Row: {
          api_client_id: string | null
          created_at: string
          expires_at: string
          id: string
          party_size: number
          reservation_area_id: string | null
          reservation_date: string
          reservation_time: string
          restaurant_id: string
          status: string
          updated_at: string
        }
        Insert: {
          api_client_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          party_size: number
          reservation_area_id?: string | null
          reservation_date: string
          reservation_time: string
          restaurant_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          api_client_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          party_size?: number
          reservation_area_id?: string | null
          reservation_date?: string
          reservation_time?: string
          restaurant_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_holds_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_holds_reservation_area_id_fkey"
            columns: ["reservation_area_id"]
            isOneToOne: false
            referencedRelation: "reservation_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_holds_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_holds_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_management_tokens: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          reservation_id: string
          restaurant_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          reservation_id: string
          restaurant_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          reservation_id?: string
          restaurant_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_management_tokens_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_management_tokens_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_management_tokens_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_operation_idempotency: {
        Row: {
          api_client_id: string
          created_at: string
          expires_at: string
          id: string
          idempotency_key: string
          operation_kind: string
          request_hash: string
          resource_id: string | null
          response_json: Json
          response_status: number
        }
        Insert: {
          api_client_id: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key: string
          operation_kind: string
          request_hash: string
          resource_id?: string | null
          response_json: Json
          response_status: number
        }
        Update: {
          api_client_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          operation_kind?: string
          request_hash?: string
          resource_id?: string | null
          response_json?: Json
          response_status?: number
        }
        Relationships: [
          {
            foreignKeyName: "reservation_operation_idempotency_api_client_id_fkey"
            columns: ["api_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          booked_by_label: string | null
          booked_by_user_id: string | null
          booking_source: string
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string
          id: string
          last_update_summary: Json | null
          last_updated_by_user_id: string | null
          notes: string | null
          party_size: number
          public_submission_id: string | null
          reservation_area_id: string | null
          reservation_date: string
          reservation_time: string
          reservation_type: string | null
          restaurant_id: string
          source_channel: string
          source_client_id: string | null
          special_requests: string | null
          status: string | null
          table_number: string | null
          updated_at: string
        }
        Insert: {
          booked_by_label?: string | null
          booked_by_user_id?: string | null
          booking_source?: string
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone: string
          id?: string
          last_update_summary?: Json | null
          last_updated_by_user_id?: string | null
          notes?: string | null
          party_size: number
          public_submission_id?: string | null
          reservation_area_id?: string | null
          reservation_date: string
          reservation_time: string
          reservation_type?: string | null
          restaurant_id: string
          source_channel?: string
          source_client_id?: string | null
          special_requests?: string | null
          status?: string | null
          table_number?: string | null
          updated_at?: string
        }
        Update: {
          booked_by_label?: string | null
          booked_by_user_id?: string | null
          booking_source?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          last_update_summary?: Json | null
          last_updated_by_user_id?: string | null
          notes?: string | null
          party_size?: number
          public_submission_id?: string | null
          reservation_area_id?: string | null
          reservation_date?: string
          reservation_time?: string
          reservation_type?: string | null
          restaurant_id?: string
          source_channel?: string
          source_client_id?: string | null
          special_requests?: string | null
          status?: string | null
          table_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_booked_by_user_id_fkey"
            columns: ["booked_by_user_id"]
            isOneToOne: false
            referencedRelation: "admin_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_reservation_area_id_fkey"
            columns: ["reservation_area_id"]
            isOneToOne: false
            referencedRelation: "reservation_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_source_client_id_fkey"
            columns: ["source_client_id"]
            isOneToOne: false
            referencedRelation: "api_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_claim_profiles: {
        Row: {
          business_contact_email: string | null
          business_email_delivery_status: string
          business_email_last_error: string | null
          business_email_paused_at: string | null
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          dataengine_batch_id: string | null
          normalized_business_contact_email: string | null
          official_domain: string | null
          official_website_url: string | null
          ownership_status: string
          restaurant_id: string
          source: string
          source_import_id: string | null
          updated_at: string
        }
        Insert: {
          business_contact_email?: string | null
          business_email_delivery_status?: string
          business_email_last_error?: string | null
          business_email_paused_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          dataengine_batch_id?: string | null
          normalized_business_contact_email?: string | null
          official_domain?: string | null
          official_website_url?: string | null
          ownership_status?: string
          restaurant_id: string
          source?: string
          source_import_id?: string | null
          updated_at?: string
        }
        Update: {
          business_contact_email?: string | null
          business_email_delivery_status?: string
          business_email_last_error?: string | null
          business_email_paused_at?: string | null
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          dataengine_batch_id?: string | null
          normalized_business_contact_email?: string | null
          official_domain?: string | null
          official_website_url?: string | null
          ownership_status?: string
          restaurant_id?: string
          source?: string
          source_import_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_claim_profiles_dataengine_batch_id_fkey"
            columns: ["dataengine_batch_id"]
            isOneToOne: false
            referencedRelation: "dataengine_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_claim_profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_claim_profiles_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_claim_profiles_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "platform_restaurant_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_claims: {
        Row: {
          approved_at: string | null
          approved_by_user_id: string | null
          claimant_user_id: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          metadata: Json
          rejected_at: string | null
          rejected_by_user_id: string | null
          requested_email: string | null
          reservation_id: string | null
          restaurant_id: string
          status: string
          token_hash: string | null
          updated_at: string
          verification_method: string
          verified_email: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          claimant_user_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          requested_email?: string | null
          reservation_id?: string | null
          restaurant_id: string
          status?: string
          token_hash?: string | null
          updated_at?: string
          verification_method?: string
          verified_email?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by_user_id?: string | null
          claimant_user_id?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          metadata?: Json
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          requested_email?: string | null
          reservation_id?: string | null
          restaurant_id?: string
          status?: string
          token_hash?: string | null
          updated_at?: string
          verification_method?: string
          verified_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_claims_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_claims_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_claims_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_domains: {
        Row: {
          created_at: string
          created_by: string | null
          dns_configured: boolean
          hostname: string
          id: string
          last_checked_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          provider: string
          provider_environment: string
          provider_verified: boolean
          restaurant_id: string
          status: string
          updated_at: string
          verification_state: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dns_configured?: boolean
          hostname: string
          id?: string
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          provider?: string
          provider_environment?: string
          provider_verified?: boolean
          restaurant_id: string
          status?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dns_configured?: boolean
          hostname?: string
          id?: string
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          provider?: string
          provider_environment?: string
          provider_verified?: boolean
          restaurant_id?: string
          status?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_domains_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_domains_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_media: {
        Row: {
          created_at: string
          id: string
          media_order: number
          media_url: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_order?: number
          media_url: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_order?: number
          media_url?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_media_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_media_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address_country: string | null
          address_line1: string | null
          address_line2: string | null
          address_locality: string | null
          address_postal_code: string | null
          address_region: string | null
          advance_booking_days: number
          allowed_days_of_week: number[]
          atmosphere: string | null
          blocked_dates: string[]
          closing_time: string
          created_at: string
          cuisine: string | null
          description: string | null
          discovery_has_banner: boolean | null
          discovery_has_business_email: boolean
          discovery_score: number | null
          events_url: string | null
          hours: string | null
          id: string
          language: string
          latitude: number | null
          location: string | null
          location_url: string | null
          logo_url: string | null
          longitude: number | null
          max_party_size: number
          meal_only_reservations: boolean
          media_type: string | null
          menu_url: string | null
          min_advance_hours: number
          min_party_size: number
          name: string
          official_website_url: string | null
          opening_time: string
          optional_guest_fields: string[]
          phone: string | null
          platform_status: string
          primary_image_url: string | null
          profile_visibility: Json
          required_guest_fields: string[]
          reservation_blocked_intervals: Json
          reservation_enabled: boolean
          reservation_notices: Json
          reservation_start_date: string | null
          slug: string
          social_links: Json
          special_hours: Json
          status: string
          time_slot_duration: number
          timezone: string
          updated_at: string
          whatsapp: string | null
          workspace_id: string
        }
        Insert: {
          address_country?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_locality?: string | null
          address_postal_code?: string | null
          address_region?: string | null
          advance_booking_days?: number
          allowed_days_of_week?: number[]
          atmosphere?: string | null
          blocked_dates?: string[]
          closing_time?: string
          created_at?: string
          cuisine?: string | null
          description?: string | null
          discovery_has_banner?: boolean | null
          discovery_has_business_email?: boolean
          discovery_score?: number | null
          events_url?: string | null
          hours?: string | null
          id?: string
          language?: string
          latitude?: number | null
          location?: string | null
          location_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          max_party_size?: number
          meal_only_reservations?: boolean
          media_type?: string | null
          menu_url?: string | null
          min_advance_hours?: number
          min_party_size?: number
          name: string
          official_website_url?: string | null
          opening_time?: string
          optional_guest_fields?: string[]
          phone?: string | null
          platform_status?: string
          primary_image_url?: string | null
          profile_visibility?: Json
          required_guest_fields?: string[]
          reservation_blocked_intervals?: Json
          reservation_enabled?: boolean
          reservation_notices?: Json
          reservation_start_date?: string | null
          slug: string
          social_links?: Json
          special_hours?: Json
          status?: string
          time_slot_duration?: number
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
          workspace_id: string
        }
        Update: {
          address_country?: string | null
          address_line1?: string | null
          address_line2?: string | null
          address_locality?: string | null
          address_postal_code?: string | null
          address_region?: string | null
          advance_booking_days?: number
          allowed_days_of_week?: number[]
          atmosphere?: string | null
          blocked_dates?: string[]
          closing_time?: string
          created_at?: string
          cuisine?: string | null
          description?: string | null
          discovery_has_banner?: boolean | null
          discovery_has_business_email?: boolean
          discovery_score?: number | null
          events_url?: string | null
          hours?: string | null
          id?: string
          language?: string
          latitude?: number | null
          location?: string | null
          location_url?: string | null
          logo_url?: string | null
          longitude?: number | null
          max_party_size?: number
          meal_only_reservations?: boolean
          media_type?: string | null
          menu_url?: string | null
          min_advance_hours?: number
          min_party_size?: number
          name?: string
          official_website_url?: string | null
          opening_time?: string
          optional_guest_fields?: string[]
          phone?: string | null
          platform_status?: string
          primary_image_url?: string | null
          profile_visibility?: Json
          required_guest_fields?: string[]
          reservation_blocked_intervals?: Json
          reservation_enabled?: boolean
          reservation_notices?: Json
          reservation_start_date?: string | null
          slug?: string
          social_links?: Json
          special_hours?: Json
          status?: string
          time_slot_duration?: number
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_until: string | null
          id: string
          plan_key: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          plan_key: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_until?: string | null
          id?: string
          plan_key?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_overrides_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "subscription_overrides_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitation_restaurants: {
        Row: {
          created_at: string
          invitation_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          invitation_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          invitation_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitation_restaurants_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "workspace_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitation_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invitation_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          delivery_error: string | null
          email: string
          email_delivery_status: string
          expires_at: string
          id: string
          invited_by: string | null
          last_sent_at: string
          normalized_email: string
          restaurant_access_mode: string
          revoked_at: string | null
          role: string
          token_hash: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          delivery_error?: string | null
          email: string
          email_delivery_status?: string
          expires_at: string
          id?: string
          invited_by?: string | null
          last_sent_at?: string
          normalized_email: string
          restaurant_access_mode?: string
          revoked_at?: string | null
          role: string
          token_hash: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          delivery_error?: string | null
          email?: string
          email_delivery_status?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          last_sent_at?: string
          normalized_email?: string
          restaurant_access_mode?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_member_restaurants: {
        Row: {
          created_at: string
          member_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_member_restaurants_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_member_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "public_restaurant_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_member_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          restaurant_access_mode: string
          role: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_access_mode?: string
          role?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_access_mode?: string
          role?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          platform: string | null
          revoked_at: string | null
          status: string
          updated_at: string
          user_agent: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          platform?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          platform?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_push_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_pwa_settings: {
        Row: {
          app_name: string | null
          background_color: string
          created_at: string
          icon_url: string | null
          theme_color: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          app_name?: string | null
          background_color?: string
          created_at?: string
          icon_url?: string | null
          theme_color?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          app_name?: string | null
          background_color?: string
          created_at?: string
          icon_url?: string | null
          theme_color?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_pwa_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_subscriptions: {
        Row: {
          billing_currency: string | null
          billing_interval: string | null
          billing_issue_code: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_end_at: string | null
          current_period_start: string | null
          current_period_start_at: string | null
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          next_billed_at: string | null
          payment_failure_started_at: string | null
          payment_grace_ends_at: string | null
          plan_key: string
          provider: string | null
          provider_customer_id: string | null
          provider_environment: string | null
          provider_price_id: string | null
          provider_status: string | null
          provider_subscription_id: string | null
          scheduled_change_action: string | null
          scheduled_change_at: string | null
          scheduled_effective_at: string | null
          scheduled_plan_at: string | null
          scheduled_plan_interval: string | null
          scheduled_plan_key: string | null
          scheduled_provider_price_id: string | null
          source: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billing_currency?: string | null
          billing_interval?: string | null
          billing_issue_code?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_end_at?: string | null
          current_period_start?: string | null
          current_period_start_at?: string | null
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          next_billed_at?: string | null
          payment_failure_started_at?: string | null
          payment_grace_ends_at?: string | null
          plan_key: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_environment?: string | null
          provider_price_id?: string | null
          provider_status?: string | null
          provider_subscription_id?: string | null
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          scheduled_effective_at?: string | null
          scheduled_plan_at?: string | null
          scheduled_plan_interval?: string | null
          scheduled_plan_key?: string | null
          scheduled_provider_price_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billing_currency?: string | null
          billing_interval?: string | null
          billing_issue_code?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_end_at?: string | null
          current_period_start?: string | null
          current_period_start_at?: string | null
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          next_billed_at?: string | null
          payment_failure_started_at?: string | null
          payment_grace_ends_at?: string | null
          plan_key?: string
          provider?: string | null
          provider_customer_id?: string | null
          provider_environment?: string | null
          provider_price_id?: string | null
          provider_status?: string | null
          provider_subscription_id?: string | null
          scheduled_change_action?: string | null
          scheduled_change_at?: string | null
          scheduled_effective_at?: string | null
          scheduled_plan_at?: string | null
          scheduled_plan_interval?: string | null
          scheduled_plan_key?: string | null
          scheduled_provider_price_id?: string | null
          source?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "workspace_subscriptions_scheduled_plan_key_fkey"
            columns: ["scheduled_plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "workspace_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_usage_periods: {
        Row: {
          created_at: string
          id: string
          period_end: string
          period_start: string
          reservations_created: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          reservations_created?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          reservations_created?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_usage_periods_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          onboarding_completed_at: string | null
          platform_status: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          onboarding_completed_at?: string | null
          platform_status?: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          onboarding_completed_at?: string | null
          platform_status?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_restaurant_directory: {
        Row: {
          address_country: string | null
          address_line1: string | null
          address_line2: string | null
          address_locality: string | null
          address_postal_code: string | null
          address_region: string | null
          atmosphere: string | null
          cuisine: string | null
          description: string | null
          discovery_has_banner: boolean | null
          discovery_has_business_email: boolean | null
          discovery_score: number | null
          events_url: string | null
          hours: string | null
          id: string | null
          language: string | null
          latitude: number | null
          location: string | null
          location_url: string | null
          logo_url: string | null
          longitude: number | null
          menu_url: string | null
          name: string | null
          official_website_url: string | null
          phone: string | null
          platform_status: string | null
          primary_image_url: string | null
          profile_visibility: Json | null
          remove_reservevia_branding: boolean | null
          reservation_enabled: boolean | null
          reservation_start_date: string | null
          slug: string | null
          social_links: Json | null
          status: string | null
          timezone: string | null
          updated_at: string | null
          whatsapp: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_workspace_invitation: {
        Args: { target_token_hash: string }
        Returns: {
          member_id: string
          restaurant_access_mode: string
          role: string
          workspace_id: string
        }[]
      }
      apply_email_delivery_webhook: {
        Args: {
          target_error: string
          target_event_at: string
          target_event_type: string
          target_pause_booking: boolean
          target_payload: Json
          target_provider_event_id: string
          target_provider_message_id: string
        }
        Returns: boolean
      }
      bootstrap_initial_workspace: {
        Args: {
          target_restaurant_name: string
          target_restaurant_slug?: string
          target_workspace_name?: string
        }
        Returns: {
          restaurant_id: string
          restaurant_slug: string
          workspace_id: string
          workspace_slug: string
        }[]
      }
      can_access_restaurant: {
        Args: { target_restaurant_id: string; target_user_id?: string }
        Returns: boolean
      }
      can_operate_restaurant: {
        Args: { target_restaurant_id: string; target_user_id?: string }
        Returns: boolean
      }
      claim_dataengine_import_batch: {
        Args: {
          target_api_client_id: string
          target_contract_version: string
          target_external_batch_id: string
          target_lease_token: string
          target_request_hash: string
          target_total_leads: number
        }
        Returns: {
          batch_id: string
          batch_status: string
          lease_acquired: boolean
          replayable: boolean
          stored_request_hash: string
        }[]
      }
      claim_dataengine_import_identity: {
        Args: {
          target_identity_key: string
          target_lead_id: string
          target_restaurant_id?: string
        }
        Returns: {
          first_lead_id: string
          is_owner: boolean
          restaurant_id: string
        }[]
      }
      claim_dataengine_lead_publish: {
        Args: { target_lead_id: string; target_lease_token: string }
        Returns: {
          claimed: boolean
          current_status: string
        }[]
      }
      claim_email_delivery_event: {
        Args: { target_event_id: string; target_lease_token: string }
        Returns: {
          attempt_count: number
          claimed: boolean
          current_status: string
          max_attempts: number
          payload: Json
        }[]
      }
      cleanup_reservation_infrastructure: {
        Args: never
        Returns: {
          deleted_idempotency_records: number
          expired_holds: number
        }[]
      }
      complete_restaurant_claim: {
        Args: {
          target_restaurant_id: string
          target_user_id: string
          target_verification_method: string
          target_verified_email: string
        }
        Returns: {
          claimed_at: string
          restaurant_id: string
          workspace_id: string
        }[]
      }
      consume_public_reservation_rate_limit: {
        Args: {
          p_key_hash: string
          p_max_attempts?: number
          p_window_seconds?: number
        }
        Returns: boolean
      }
      convert_reservation_hold: {
        Args: {
          p_api_client_id: string
          p_customer_email: string
          p_customer_name: string
          p_customer_phone: string
          p_hold_id: string
          p_reservation_type: string
          p_source_channel: string
          p_special_requests: string
        }
        Returns: {
          reservation_id: string
        }[]
      }
      create_reservation_access_records: {
        Args: {
          target_business_email: string
          target_claim_expires_at: string
          target_claim_token_hash: string
          target_manage_expires_at: string
          target_manage_token_hash: string
          target_reservation_id: string
          target_restaurant_id: string
        }
        Returns: {
          claim_id: string
          management_token_id: string
        }[]
      }
      create_reservation_hold: {
        Args: {
          p_api_client_id: string
          p_party_size: number
          p_reservation_area_id: string
          p_reservation_date: string
          p_reservation_time: string
          p_restaurant_id: string
          p_ttl_seconds: number
        }
        Returns: {
          expires_at: string
          hold_id: string
        }[]
      }
      create_workspace_invitation: {
        Args: {
          target_access_mode?: string
          target_email: string
          target_role: string
          target_selected_restaurant_ids?: string[]
          target_token_hash?: string
          target_workspace_id: string
        }
        Returns: {
          expires_at: string
          invitation_id: string
          normalized_email: string
          restaurant_access_mode: string
          role: string
          workspace_id: string
        }[]
      }
      finalize_dataengine_lead_publication: {
        Args: {
          target_lead_id: string
          target_profile: Json
          target_public_banner_url: string
          target_restaurant_id: string
        }
        Returns: {
          final_status: string
          published: boolean
        }[]
      }
      get_area_effective_settings: {
        Args: { area_id: string }
        Returns: {
          advance_booking_days: number
          allowed_days_of_week: number[]
          closing_time: string
          max_party_size: number
          min_advance_hours: number
          min_party_size: number
          opening_time: string
          time_slot_duration: number
        }[]
      }
      get_dashboard_stats: {
        Args: {
          p_end_date?: string
          p_restaurant_id?: string
          p_start_date?: string
        }
        Returns: {
          cancelled: number
          confirmed: number
          deck_kuvers: number
          pending: number
          percent_change: number
          terrace_kuvers: number
          total: number
          total_kuver: number
          total_meal_reservations: number
        }[]
      }
      has_workspace_role: {
        Args: {
          allowed_roles: string[]
          target_user_id?: string
          target_workspace_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { target_user_id?: string; target_workspace_id: string }
        Returns: boolean
      }
      link_dataengine_identity_to_restaurant: {
        Args: { target_lead_id: string; target_restaurant_id: string }
        Returns: undefined
      }
      provision_dataengine_lead_tenant: {
        Args: {
          target_batch_id: string
          target_business_contact_email: string
          target_lead_id: string
          target_official_domain: string
          target_official_website_url: string
          target_profile: Json
          target_restaurant_name: string
        }
        Returns: {
          restaurant_id: string
          restaurant_slug: string
          workspace_id: string
          workspace_slug: string
        }[]
      }
      provision_restaurant_workspace: {
        Args: {
          target_business_contact_email?: string
          target_claim_status?: string
          target_official_domain?: string
          target_official_website_url?: string
          target_owner_user_id?: string
          target_profile?: Json
          target_restaurant_name: string
          target_restaurant_slug?: string
          target_restaurant_status?: string
          target_source?: string
          target_source_import_id?: string
          target_workspace_id?: string
          target_workspace_name?: string
        }
        Returns: {
          restaurant_id: string
          restaurant_slug: string
          workspace_id: string
          workspace_slug: string
        }[]
      }
      release_dataengine_import_identity: {
        Args: { target_lead_id: string }
        Returns: undefined
      }
      search_public_restaurants: {
        Args: {
          p_after?: Json
          p_atmosphere?: string
          p_cuisine?: string
          p_limit?: number
          p_location?: string
          p_query?: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_platform_restaurant_from_import: {
        Args: {
          target_payload: Json
          target_provided_fields?: string[]
          target_restaurant_id: string
        }
        Returns: {
          restaurant_id: string
          restaurant_slug: string
          workspace_id: string
        }[]
      }
      update_workspace_member: {
        Args: {
          target_access_mode?: string
          target_member_id: string
          target_role: string
          target_selected_restaurant_ids?: string[]
          target_workspace_id: string
        }
        Returns: {
          member_id: string
          restaurant_access_mode: string
          role: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const



// Compatibility aliases used by the existing management components. The
// underlying table definitions are generated from the local Reservevia
// schema by `npm run db:types`.
export type Restaurant = Database["public"]["Tables"]["restaurants"]["Row"]
export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"]
export type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"]
export type RestaurantMedia = Database["public"]["Tables"]["restaurant_media"]["Row"]
export type ReservationArea = Database["public"]["Tables"]["reservation_areas"]["Row"]
export type Reservation = Database["public"]["Tables"]["reservations"]["Row"]
export type AdminProfile = Database["public"]["Tables"]["admin_profiles"]["Row"]
export type AdminPushSubscription = Database["public"]["Tables"]["admin_push_subscriptions"]["Row"]
export type NotificationSettings = Database["public"]["Tables"]["notification_settings"]["Row"]
export type Plan = Database["public"]["Tables"]["plans"]["Row"]
export type WorkspaceSubscription = Database["public"]["Tables"]["workspace_subscriptions"]["Row"]
export type WorkspaceUsagePeriod = Database["public"]["Tables"]["workspace_usage_periods"]["Row"]
export type RestaurantDomain = Database["public"]["Tables"]["restaurant_domains"]["Row"]
export type WorkspacePwaSettings = Database["public"]["Tables"]["workspace_pwa_settings"]["Row"]
export type WorkspacePushSubscription = Database["public"]["Tables"]["workspace_push_subscriptions"]["Row"]
export type PlatformUserDirectory = Database["public"]["Tables"]["platform_user_directory"]["Row"]
export type DataEngineImportBatch = Database["public"]["Tables"]["dataengine_import_batches"]["Row"]
export type DataEngineImportLead = Database["public"]["Tables"]["dataengine_import_leads"]["Row"]
export type DataEngineImportEvidence = Database["public"]["Tables"]["dataengine_import_evidence"]["Row"]
export type EmailDeliveryEvent = Database["public"]["Tables"]["email_delivery_events"]["Row"]
export type EmailOutboxRun = Database["public"]["Tables"]["email_outbox_runs"]["Row"]
