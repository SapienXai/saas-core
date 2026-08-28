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
          dedupe_key: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          kind: string
          last_error: string | null
          last_provider_event_at: string | null
          lease_token: string | null
          lease_until: string | null
          max_attempts: number
          metadata: Json
          next_attempt_at: string | null
          payload: Json
          provider: string | null
          provider_message_id: string | null
          recipient_email: string
          sent_at: string | null
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_email: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          metadata?: Json
          next_attempt_at?: string | null
          payload?: Json
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_delivery_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
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
          created_at: string
          event_at: string | null
          event_type: string
          id: string
          payload: Json
          provider_event_id: string
          provider_message_id: string
        }
        Insert: {
          created_at?: string
          event_at?: string | null
          event_type: string
          id?: string
          payload?: Json
          provider_event_id: string
          provider_message_id: string
        }
        Update: {
          created_at?: string
          event_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          provider_event_id?: string
          provider_message_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          features: Json
          key: string
          limits: Json
          metadata: Json
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          features?: Json
          key: string
          limits?: Json
          metadata?: Json
          name: string
          sort_order: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          features?: Json
          key?: string
          limits?: Json
          metadata?: Json
          name?: string
          sort_order?: number
          updated_at?: string
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
      workspace_domains: {
        Row: {
          created_at: string
          dns_configured: boolean
          hostname: string
          id: string
          last_checked_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          provider: string
          provider_environment: string
          provider_verified: boolean
          status: string
          updated_at: string
          verification_state: string
          verified_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dns_configured?: boolean
          hostname: string
          id?: string
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          provider?: string
          provider_environment?: string
          provider_verified?: boolean
          status?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          dns_configured?: boolean
          hostname?: string
          id?: string
          last_checked_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          provider?: string
          provider_environment?: string
          provider_verified?: boolean
          status?: string
          updated_at?: string
          verification_state?: string
          verified_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
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
          last_sent_at: string | null
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
          last_sent_at?: string | null
          revoked_at?: string | null
          role?: string
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
          last_sent_at?: string | null
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
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
          updated_at: string
          usage: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          updated_at?: string
          usage?: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
          usage?: Json
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
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invitation: {
        Args: { target_token_hash: string }
        Returns: {
          workspace_id: string
        }[]
      }
      apply_email_delivery_webhook: {
        Args: {
          target_error: string
          target_event_at: string
          target_event_type: string
          target_pause_delivery: boolean
          target_payload: Json
          target_provider_event_id: string
          target_provider_message_id: string
        }
        Returns: boolean
      }
      bootstrap_initial_workspace: {
        Args: { target_workspace_name: string; target_workspace_slug?: string }
        Returns: {
          workspace_id: string
          workspace_slug: string
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
      create_workspace_invitation: {
        Args: {
          target_email: string
          target_role: string
          target_token_hash: string
          target_workspace_id: string
        }
        Returns: {
          expires_at: string
          invitation_id: string
        }[]
      }
      get_core_schema_metadata: {
        Args: never
        Returns: {
          runtime_major: number
          schema_version: string
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
      is_platform_member: {
        Args: { target_user_id?: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { target_user_id?: string; target_workspace_id: string }
        Returns: boolean
      }
      sync_core_catalog: {
        Args: {
          target_deactivate_missing?: boolean
          target_default_plan_key: string
          target_plans: Json
        }
        Returns: {
          configured_default_plan_key: string
          deactivated_count: number
          synchronized_count: number
        }[]
      }
      update_workspace_member: {
        Args: {
          target_member_id: string
          target_role: string
          target_workspace_id: string
        }
        Returns: boolean
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



export type Workspace = Database["public"]["Tables"]["workspaces"]["Row"]
export type WorkspaceMember = Database["public"]["Tables"]["workspace_members"]["Row"]
export type WorkspaceInvitation = Database["public"]["Tables"]["workspace_invitations"]["Row"]
export type Plan = Database["public"]["Tables"]["plans"]["Row"]
export type WorkspaceSubscription = Database["public"]["Tables"]["workspace_subscriptions"]["Row"]
export type WorkspaceUsagePeriod = Database["public"]["Tables"]["workspace_usage_periods"]["Row"]
export type WorkspaceDomain = Database["public"]["Tables"]["workspace_domains"]["Row"]
export type WorkspacePwaSettings = Database["public"]["Tables"]["workspace_pwa_settings"]["Row"]
export type WorkspacePushSubscription = Database["public"]["Tables"]["workspace_push_subscriptions"]["Row"]
export type PlatformMember = Database["public"]["Tables"]["platform_members"]["Row"]
export type PlatformAuditLog = Database["public"]["Tables"]["platform_audit_logs"]["Row"]
export type EmailDeliveryEvent = Database["public"]["Tables"]["email_delivery_events"]["Row"]
export type EmailOutboxRun = Database["public"]["Tables"]["email_outbox_runs"]["Row"]
