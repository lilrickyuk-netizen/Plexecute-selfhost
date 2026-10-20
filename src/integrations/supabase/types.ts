export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_access_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          metadata: Json
          reason: string | null
          target_ref: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_ref?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string | null
          target_ref?: string | null
        }
        Relationships: []
      }
      ai_credit_ledger: {
        Row: {
          amount_micro: number
          created_at: string
          external_ref: string | null
          id: string
          reason: string
          user_id: string
        }
        Insert: {
          amount_micro: number
          created_at?: string
          external_ref?: string | null
          id?: string
          reason: string
          user_id: string
        }
        Update: {
          amount_micro?: number
          created_at?: string
          external_ref?: string | null
          id?: string
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          day: string
          input_tokens: number
          output_tokens: number
          user_id: string
        }
        Insert: {
          day: string
          input_tokens?: number
          output_tokens?: number
          user_id: string
        }
        Update: {
          day?: string
          input_tokens?: number
          output_tokens?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_booking_events: {
        Row: {
          booking_id: string
          created_at: string
          detail: Json
          event: string
          from_status: string | null
          id: string
          to_status: string | null
          user_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          detail?: Json
          event: string
          from_status?: string | null
          id?: string
          to_status?: string | null
          user_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          detail?: Json
          event?: string
          from_status?: string | null
          id?: string
          to_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "appointment_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_bookings: {
        Row: {
          call_log_id: string | null
          cancellation_terms: string | null
          category: string | null
          checkout_amount_minor: number | null
          checkout_created_at: string | null
          checkout_expires_at: string | null
          checkout_fee_minor: number | null
          checkout_url: string | null
          commitment_id: string | null
          confirmation_source: string | null
          constraints: Json
          created_at: string
          currency: string | null
          deposit_minor: number | null
          details: Json
          end_time: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          kind: string
          method: string | null
          options: Json
          payment_state: string
          preauthorisation: Json | null
          preauthorised: boolean
          prep_notes: string | null
          price_minor: number | null
          provider_address: string | null
          provider_name: string | null
          provider_phone_enc: string | null
          provider_url: string | null
          reference: string | null
          replaces_booking_id: string | null
          request_text: string | null
          service: string
          slot_date: string | null
          start_time: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          call_log_id?: string | null
          cancellation_terms?: string | null
          category?: string | null
          checkout_amount_minor?: number | null
          checkout_created_at?: string | null
          checkout_expires_at?: string | null
          checkout_fee_minor?: number | null
          checkout_url?: string | null
          commitment_id?: string | null
          confirmation_source?: string | null
          constraints?: Json
          created_at?: string
          currency?: string | null
          deposit_minor?: number | null
          details?: Json
          end_time?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          kind?: string
          method?: string | null
          options?: Json
          payment_state?: string
          preauthorisation?: Json | null
          preauthorised?: boolean
          prep_notes?: string | null
          price_minor?: number | null
          provider_address?: string | null
          provider_name?: string | null
          provider_phone_enc?: string | null
          provider_url?: string | null
          reference?: string | null
          replaces_booking_id?: string | null
          request_text?: string | null
          service: string
          slot_date?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          call_log_id?: string | null
          cancellation_terms?: string | null
          category?: string | null
          checkout_amount_minor?: number | null
          checkout_created_at?: string | null
          checkout_expires_at?: string | null
          checkout_fee_minor?: number | null
          checkout_url?: string | null
          commitment_id?: string | null
          confirmation_source?: string | null
          constraints?: Json
          created_at?: string
          currency?: string | null
          deposit_minor?: number | null
          details?: Json
          end_time?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          method?: string | null
          options?: Json
          payment_state?: string
          preauthorisation?: Json | null
          preauthorised?: boolean
          prep_notes?: string | null
          price_minor?: number | null
          provider_address?: string | null
          provider_name?: string | null
          provider_phone_enc?: string | null
          provider_url?: string | null
          reference?: string | null
          replaces_booking_id?: string | null
          request_text?: string | null
          service?: string
          slot_date?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_type: string
          created_at: string
          id: string
          metadata: Json
          outcome: string
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          actor_type: string
          created_at?: string
          id?: string
          metadata?: Json
          outcome: string
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          outcome?: string
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_adapt_permissions: {
        Row: {
          enabled: boolean
          permission: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          permission: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          permission?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_adapt_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      background_job_events: {
        Row: {
          actor: string
          attempt: number
          created_at: string
          detail: string | null
          event: string
          id: number
          job_id: string
        }
        Insert: {
          actor?: string
          attempt?: number
          created_at?: string
          detail?: string | null
          event: string
          id?: never
          job_id: string
        }
        Update: {
          actor?: string
          attempt?: number
          created_at?: string
          detail?: string | null
          event?: string
          id?: never
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      background_jobs: {
        Row: {
          attempts: number
          created_at: string
          duration_ms: number | null
          finished_at: string | null
          id: string
          idempotency_key: string
          kind: string
          last_error: string | null
          lease_until: string | null
          max_attempts: number
          next_attempt_at: string
          payload: Json
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          kind: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          last_error?: string | null
          lease_until?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      behaviour_feedback: {
        Row: {
          created_at: string
          note: string | null
          observation_key: string
          user_id: string
          verdict: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          observation_key: string
          user_id: string
          verdict: string
        }
        Update: {
          created_at?: string
          note?: string | null
          observation_key?: string
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "behaviour_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          id: string
          received_at: string
          type: string
        }
        Insert: {
          id: string
          received_at?: string
          type: string
        }
        Update: {
          id?: string
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      calendar_busy: {
        Row: {
          all_day: boolean
          busy: boolean
          calendar_id_hash: string | null
          connection_id: string
          created_at: string
          ends_at: string
          event_hash: string
          id: string
          starts_at: string
          time_zone: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          all_day?: boolean
          busy?: boolean
          calendar_id_hash?: string | null
          connection_id: string
          created_at?: string
          ends_at: string
          event_hash: string
          id?: string
          starts_at: string
          time_zone?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          all_day?: boolean
          busy?: boolean
          calendar_id_hash?: string | null
          connection_id?: string
          created_at?: string
          ends_at?: string
          event_hash?: string
          id?: string
          starts_at?: string
          time_zone?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_busy_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_busy_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_label: string | null
          all_day_hard: boolean
          calendar_id_hash: string | null
          created_at: string
          error_count: number
          id: string
          last_error: string | null
          last_sync_at: string | null
          mode: string
          provider: string
          status: string
          updated_at: string
          user_id: string
          write_calendar_id: string | null
        }
        Insert: {
          account_label?: string | null
          all_day_hard?: boolean
          calendar_id_hash?: string | null
          created_at?: string
          error_count?: number
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mode?: string
          provider: string
          status?: string
          updated_at?: string
          user_id: string
          write_calendar_id?: string | null
        }
        Update: {
          account_label?: string | null
          all_day_hard?: boolean
          calendar_id_hash?: string | null
          created_at?: string
          error_count?: number
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          mode?: string
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
          write_calendar_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_credentials: {
        Row: {
          access_token: string | null
          channel_expires_at: string | null
          channel_id: string | null
          channel_resource: string | null
          connection_id: string
          expires_at: string | null
          refresh_token: string | null
          scopes: string[]
          sync_cursor: string | null
          updated_at: string
          user_id: string
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          channel_expires_at?: string | null
          channel_id?: string | null
          channel_resource?: string | null
          connection_id: string
          expires_at?: string | null
          refresh_token?: string | null
          scopes?: string[]
          sync_cursor?: string | null
          updated_at?: string
          user_id: string
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          channel_expires_at?: string | null
          channel_id?: string | null
          channel_resource?: string | null
          connection_id?: string
          expires_at?: string | null
          refresh_token?: string | null
          scopes?: string[]
          sync_cursor?: string | null
          updated_at?: string
          user_id?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_credentials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_event_links: {
        Row: {
          block_id: string
          connection_id: string
          content_hash: string | null
          created_at: string
          external_event_id: string | null
          external_starts_at: string | null
          id: string
          idempotency_key: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          block_id: string
          connection_id: string
          content_hash?: string | null
          created_at?: string
          external_event_id?: string | null
          external_starts_at?: string | null
          id?: string
          idempotency_key: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          block_id?: string
          connection_id?: string
          content_hash?: string | null
          created_at?: string
          external_event_id?: string | null
          external_starts_at?: string | null
          id?: string
          idempotency_key?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_event_links_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      call_campaigns: {
        Row: {
          acknowledgement: string | null
          attempts: number
          block_id: string | null
          connected_seconds: number
          consumed_at: string | null
          created_at: string
          dedupe_key: string
          id: string
          max_attempts: number
          next_attempt_at: string | null
          policy: string
          service_month_start: string
          state: string
          stop_reason: string | null
          trigger: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledgement?: string | null
          attempts?: number
          block_id?: string | null
          connected_seconds?: number
          consumed_at?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          max_attempts: number
          next_attempt_at?: string | null
          policy: string
          service_month_start: string
          state?: string
          stop_reason?: string | null
          trigger: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledgement?: string | null
          attempts?: number
          block_id?: string | null
          connected_seconds?: number
          consumed_at?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          max_attempts?: number
          next_attempt_at?: string | null
          policy?: string
          service_month_start?: string
          state?: string
          stop_reason?: string | null
          trigger?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_campaigns_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          answered_by: string | null
          attempt_no: number | null
          booking_id: string | null
          call_sid: string | null
          campaign_id: string | null
          connected_seconds: number
          created_at: string
          duration_sec: number | null
          id: string
          outcome: string | null
          provider_status: string | null
          status: string
          summary: string | null
          tool_trace: Json
          updated_at: string
          user_id: string
          voice_end_reason: string | null
          voice_failovers: number
          voice_provider: string | null
          voice_seconds: number
        }
        Insert: {
          answered_by?: string | null
          attempt_no?: number | null
          booking_id?: string | null
          call_sid?: string | null
          campaign_id?: string | null
          connected_seconds?: number
          created_at?: string
          duration_sec?: number | null
          id?: string
          outcome?: string | null
          provider_status?: string | null
          status?: string
          summary?: string | null
          tool_trace?: Json
          updated_at?: string
          user_id: string
          voice_end_reason?: string | null
          voice_failovers?: number
          voice_provider?: string | null
          voice_seconds?: number
        }
        Update: {
          answered_by?: string | null
          attempt_no?: number | null
          booking_id?: string | null
          call_sid?: string | null
          campaign_id?: string | null
          connected_seconds?: number
          created_at?: string
          duration_sec?: number | null
          id?: string
          outcome?: string | null
          provider_status?: string | null
          status?: string
          summary?: string | null
          tool_trace?: Json
          updated_at?: string
          user_id?: string
          voice_end_reason?: string | null
          voice_failovers?: number
          voice_provider?: string | null
          voice_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "call_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      call_market_manifest: {
        Row: {
          approval_basis: string
          consent_version: string | null
          country: string
          created_at: string
          disclosure_version: string | null
          enabled: boolean
          killed: boolean
          max_attempts_per_occurrence: number | null
          max_per_24h: number | null
          min_answer_rate: number | null
          notes: string | null
          permitted_end: string | null
          permitted_start: string | null
          pro_retry_allowed: boolean
          review_ref: string | null
          signed_off_at: string | null
          signed_off_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_basis?: string
          consent_version?: string | null
          country: string
          created_at?: string
          disclosure_version?: string | null
          enabled?: boolean
          killed?: boolean
          max_attempts_per_occurrence?: number | null
          max_per_24h?: number | null
          min_answer_rate?: number | null
          notes?: string | null
          permitted_end?: string | null
          permitted_start?: string | null
          pro_retry_allowed?: boolean
          review_ref?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_basis?: string
          consent_version?: string | null
          country?: string
          created_at?: string
          disclosure_version?: string | null
          enabled?: boolean
          killed?: boolean
          max_attempts_per_occurrence?: number | null
          max_per_24h?: number | null
          min_answer_rate?: number | null
          notes?: string | null
          permitted_end?: string | null
          permitted_start?: string | null
          pro_retry_allowed?: boolean
          review_ref?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cancellation_reasons: {
        Row: {
          created_at: string
          details: string | null
          id: string
          reason: string
          tier: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          reason: string
          tier?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          reason?: string
          tier?: string | null
          user_id?: string
        }
        Relationships: []
      }
      career_research: {
        Row: {
          created_at: string
          goal_id: string | null
          id: string
          interpretation: string | null
          jurisdiction: string
          query: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_id?: string | null
          id?: string
          interpretation?: string | null
          jurisdiction: string
          query: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string | null
          id?: string
          interpretation?: string | null
          jurisdiction?: string
          query?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_research_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_research_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_messages: {
        Row: {
          actions: Json
          content: string
          contract: Json | null
          created_at: string
          id: string
          mode: string
          role: string
          tool_trace: Json
          user_id: string
        }
        Insert: {
          actions?: Json
          content: string
          contract?: Json | null
          created_at?: string
          id?: string
          mode?: string
          role: string
          tool_trace?: Json
          user_id: string
        }
        Update: {
          actions?: Json
          content?: string
          contract?: Json | null
          created_at?: string
          id?: string
          mode?: string
          role?: string
          tool_trace?: Json
          user_id?: string
        }
        Relationships: []
      }
      coach_pending_actions: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          kind: string
          payload: Json
          result: Json | null
          source_message: string | null
          status: string
          summary: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind: string
          payload?: Json
          result?: Json | null
          source_message?: string | null
          status?: string
          summary: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          source_message?: string | null
          status?: string
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      coach_standing_orders: {
        Row: {
          active: boolean
          created_at: string
          ended_reason: string | null
          goal_id: string | null
          id: string
          kind: string
          last_result: Json | null
          last_run_at: string | null
          params: Json
          source_message: string | null
          target_weight_kg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          ended_reason?: string | null
          goal_id?: string | null
          id?: string
          kind: string
          last_result?: Json | null
          last_run_at?: string | null
          params?: Json
          source_message?: string | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          ended_reason?: string | null
          goal_id?: string | null
          id?: string
          kind?: string
          last_result?: Json | null
          last_run_at?: string | null
          params?: Json
          source_message?: string | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      coach_tool_calls: {
        Row: {
          allowed: boolean
          args: Json
          created_at: string
          id: string
          message_id: string | null
          reason: string | null
          tool: string
          user_id: string
        }
        Insert: {
          allowed: boolean
          args?: Json
          created_at?: string
          id?: string
          message_id?: string | null
          reason?: string | null
          tool: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          args?: Json
          created_at?: string
          id?: string
          message_id?: string | null
          reason?: string | null
          tool?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_tool_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "coach_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_tool_calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commitments: {
        Row: {
          active: boolean
          booking_id: string | null
          created_at: string
          days: number[]
          dedupe_key: string | null
          end_time: string
          id: string
          is_hard: boolean
          kind: string
          location: string | null
          note: string | null
          on_date: string | null
          recurrence: string
          source: string
          start_time: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          booking_id?: string | null
          created_at?: string
          days?: number[]
          dedupe_key?: string | null
          end_time: string
          id?: string
          is_hard?: boolean
          kind: string
          location?: string | null
          note?: string | null
          on_date?: string | null
          recurrence: string
          source?: string
          start_time: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          booking_id?: string | null
          created_at?: string
          days?: number[]
          dedupe_key?: string | null
          end_time?: string
          id?: string
          is_hard?: boolean
          kind?: string
          location?: string | null
          note?: string | null
          on_date?: string | null
          recurrence?: string
          source?: string
          start_time?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commitments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          action: string
          created_at: string
          domain: string | null
          id: string
          metadata: Json
          occurred_at: string
          policy_version: string
          provider: string | null
          purpose: string
          scope: string[]
          source: string
          subject_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          domain?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          policy_version: string
          provider?: string | null
          purpose: string
          scope?: string[]
          source?: string
          subject_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          domain?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          policy_version?: string
          provider?: string | null
          purpose?: string
          scope?: string[]
          source?: string
          subject_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          created_at: string
          id: string
          kind: string
          log_date: string
          note: string | null
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          log_date?: string
          note?: string | null
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          log_date?: string
          note?: string | null
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      data_rights_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          details: string | null
          due_at: string
          id: string
          identity_check: string
          paused_reason: string | null
          received_at: string
          request_type: string
          response: string | null
          search_scope: string[] | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          details?: string | null
          due_at?: string
          id?: string
          identity_check?: string
          paused_reason?: string | null
          received_at?: string
          request_type: string
          response?: string | null
          search_scope?: string[] | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          details?: string | null
          due_at?: string
          id?: string
          identity_check?: string
          paused_reason?: string | null
          received_at?: string
          request_type?: string
          response?: string | null
          search_scope?: string[] | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      deletion_jobs: {
        Row: {
          completed_at: string | null
          error: string | null
          id: string
          purge_by: string
          requested_at: string
          status: string
          steps: Json
          subject_ref: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          id?: string
          purge_by?: string
          requested_at?: string
          status?: string
          steps?: Json
          subject_ref: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          id?: string
          purge_by?: string
          requested_at?: string
          status?: string
          steps?: Json
          subject_ref?: string
        }
        Relationships: []
      }
      entitlement_ledger: {
        Row: {
          amount: number
          capability: string
          created_at: string
          external_ref: string | null
          id: string
          period_end: string | null
          period_start: string | null
          reason: string
          user_id: string
        }
        Insert: {
          amount: number
          capability: string
          created_at?: string
          external_ref?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          reason: string
          user_id: string
        }
        Update: {
          amount?: number
          capability?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          period_end?: string | null
          period_start?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      error_events: {
        Row: {
          created_at: string
          fingerprint: string
          forwarded: boolean
          id: string
          message: string
          release: string | null
          request_id: string | null
          route: string | null
          source: string
          user_ref: string | null
        }
        Insert: {
          created_at?: string
          fingerprint: string
          forwarded?: boolean
          id?: string
          message: string
          release?: string | null
          request_id?: string | null
          route?: string | null
          source: string
          user_ref?: string | null
        }
        Update: {
          created_at?: string
          fingerprint?: string
          forwarded?: boolean
          id?: string
          message?: string
          release?: string | null
          request_id?: string | null
          route?: string | null
          source?: string
          user_ref?: string | null
        }
        Relationships: []
      }
      evidence_claims: {
        Row: {
          block_id: string
          created_at: string
          id: string
          source_kind: string
          source_ref: string
          user_id: string
        }
        Insert: {
          block_id: string
          created_at?: string
          id?: string
          source_kind: string
          source_ref: string
          user_id: string
        }
        Update: {
          block_id?: string
          created_at?: string
          id?: string
          source_kind?: string
          source_ref?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_claims_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_rewards: {
        Row: {
          amount_pence: number
          applied_at: string | null
          apply_attempts: number
          completed_count: number
          created_at: string
          currency: string
          customer_id: string
          decided_at: string | null
          earned_at: string | null
          evaluation: Json
          id: string
          last_error: string | null
          next_renewal_ref: string | null
          period_end: string
          period_start: string
          plan_version_ids: string[]
          policy_version: string
          provider: string
          provider_credit_ref: string | null
          provider_invoice_ref: string | null
          required_count: number
          state: string
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_pence?: number
          applied_at?: string | null
          apply_attempts?: number
          completed_count?: number
          created_at?: string
          currency?: string
          customer_id: string
          decided_at?: string | null
          earned_at?: string | null
          evaluation?: Json
          id?: string
          last_error?: string | null
          next_renewal_ref?: string | null
          period_end: string
          period_start: string
          plan_version_ids?: string[]
          policy_version: string
          provider?: string
          provider_credit_ref?: string | null
          provider_invoice_ref?: string | null
          required_count?: number
          state?: string
          subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_pence?: number
          applied_at?: string | null
          apply_attempts?: number
          completed_count?: number
          created_at?: string
          currency?: string
          customer_id?: string
          decided_at?: string | null
          earned_at?: string | null
          evaluation?: Json
          id?: string
          last_error?: string | null
          next_renewal_ref?: string | null
          period_end?: string
          period_start?: string
          plan_version_ids?: string[]
          policy_version?: string
          provider?: string
          provider_credit_ref?: string | null
          provider_invoice_ref?: string | null
          required_count?: number
          state?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exercise_demo_cache: {
        Row: {
          candidates: Json
          exercise_key: string
          refreshed_at: string
        }
        Insert: {
          candidates?: Json
          exercise_key: string
          refreshed_at?: string
        }
        Update: {
          candidates?: Json
          exercise_key?: string
          refreshed_at?: string
        }
        Relationships: []
      }
      experiment_entries: {
        Row: {
          condition: string | null
          created_at: string
          entry_date: string
          experiment_id: string
          id: string
          note: string | null
          user_id: string
          value: number
        }
        Insert: {
          condition?: string | null
          created_at?: string
          entry_date?: string
          experiment_id: string
          id?: string
          note?: string | null
          user_id: string
          value: number
        }
        Update: {
          condition?: string | null
          created_at?: string
          entry_date?: string
          experiment_id?: string
          id?: string
          note?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "experiment_entries_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          baseline_days: number
          conclusion: string | null
          confounders: string | null
          created_at: string
          design: string
          end_date: string | null
          hypothesis: string
          id: string
          metric: string
          min_obs: number
          policy_version: string | null
          question: string | null
          result: Json | null
          safety_checked_at: string | null
          schedule: Json
          start_date: string
          status: string
          test_days: number
          title: string
          user_id: string
          variant_a: string | null
          variant_b: string | null
        }
        Insert: {
          baseline_days?: number
          conclusion?: string | null
          confounders?: string | null
          created_at?: string
          design?: string
          end_date?: string | null
          hypothesis: string
          id?: string
          metric: string
          min_obs?: number
          policy_version?: string | null
          question?: string | null
          result?: Json | null
          safety_checked_at?: string | null
          schedule?: Json
          start_date?: string
          status?: string
          test_days?: number
          title: string
          user_id: string
          variant_a?: string | null
          variant_b?: string | null
        }
        Update: {
          baseline_days?: number
          conclusion?: string | null
          confounders?: string | null
          created_at?: string
          design?: string
          end_date?: string | null
          hypothesis?: string
          id?: string
          metric?: string
          min_obs?: number
          policy_version?: string | null
          question?: string | null
          result?: Json | null
          safety_checked_at?: string | null
          schedule?: Json
          start_date?: string
          status?: string
          test_days?: number
          title?: string
          user_id?: string
          variant_a?: string | null
          variant_b?: string | null
        }
        Relationships: []
      }
      feature_flags: {
        Row: {
          cap_value: number | null
          enabled: boolean
          key: string
          note: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cap_value?: number | null
          enabled?: boolean
          key: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cap_value?: number | null
          enabled?: boolean
          key?: string
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      food_entries: {
        Row: {
          carbs_g: number
          client_op_id: string | null
          client_recorded_at: string | null
          created_at: string
          eaten_on: string
          estimated: boolean
          fat_g: number
          fibre_g: number | null
          food_id: string | null
          grams: number | null
          id: string
          kcal: number
          meal_slot: string
          name: string
          protein_g: number
          source: string
          user_id: string
        }
        Insert: {
          carbs_g?: number
          client_op_id?: string | null
          client_recorded_at?: string | null
          created_at?: string
          eaten_on?: string
          estimated?: boolean
          fat_g?: number
          fibre_g?: number | null
          food_id?: string | null
          grams?: number | null
          id?: string
          kcal?: number
          meal_slot?: string
          name: string
          protein_g?: number
          source?: string
          user_id: string
        }
        Update: {
          carbs_g?: number
          client_op_id?: string | null
          client_recorded_at?: string | null
          created_at?: string
          eaten_on?: string
          estimated?: boolean
          fat_g?: number
          fibre_g?: number | null
          food_id?: string | null
          grams?: number | null
          id?: string
          kcal?: number
          meal_slot?: string
          name?: string
          protein_g?: number
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_entries_food_id_fkey"
            columns: ["food_id"]
            isOneToOne: false
            referencedRelation: "user_foods"
            referencedColumns: ["id"]
          },
        ]
      }
      food_inventory: {
        Row: {
          allergens: string[]
          confirmed_at: string | null
          created_at: string
          expires_on: string | null
          food_key: string | null
          grams: number | null
          id: string
          import_key: string | null
          item_count: number | null
          name: string
          nutrition_source: string
          per100: Json | null
          quantity_status: string
          source: string
          status: string
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allergens?: string[]
          confirmed_at?: string | null
          created_at?: string
          expires_on?: string | null
          food_key?: string | null
          grams?: number | null
          id?: string
          import_key?: string | null
          item_count?: number | null
          name: string
          nutrition_source?: string
          per100?: Json | null
          quantity_status?: string
          source: string
          status?: string
          unit?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allergens?: string[]
          confirmed_at?: string | null
          created_at?: string
          expires_on?: string | null
          food_key?: string | null
          grams?: number | null
          id?: string
          import_key?: string | null
          item_count?: number | null
          name?: string
          nutrition_source?: string
          per100?: Json | null
          quantity_status?: string
          source?: string
          status?: string
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          day: string
          source: string
          usd_per_gbp: number
        }
        Insert: {
          day: string
          source: string
          usd_per_gbp: number
        }
        Update: {
          day?: string
          source?: string
          usd_per_gbp?: number
        }
        Relationships: []
      }
      geocode_cache: {
        Row: {
          created_at: string
          formatted: string
          lat: number
          lng: number
          query: string
        }
        Insert: {
          created_at?: string
          formatted: string
          lat: number
          lng: number
          query: string
        }
        Update: {
          created_at?: string
          formatted?: string
          lat?: number
          lng?: number
          query?: string
        }
        Relationships: []
      }
      goal_intentions: {
        Row: {
          active: boolean
          created_at: string
          goal_id: string
          id: string
          kind: string
          then_text: string
          user_id: string
          when_text: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          goal_id: string
          id?: string
          kind: string
          then_text: string
          user_id: string
          when_text: string
        }
        Update: {
          active?: boolean
          created_at?: string
          goal_id?: string
          id?: string
          kind?: string
          then_text?: string
          user_id?: string
          when_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_intentions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_intentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_metric_entries: {
        Row: {
          goal_id: string
          id: string
          note: string | null
          recorded_at: string
          source: string
          user_id: string
          value: number
        }
        Insert: {
          goal_id: string
          id?: string
          note?: string | null
          recorded_at?: string
          source?: string
          user_id: string
          value: number
        }
        Update: {
          goal_id?: string
          id?: string
          note?: string | null
          recorded_at?: string
          source?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_metric_entries_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_milestones: {
        Row: {
          actions: Json
          blocked_reason: string | null
          capability: string | null
          cost: number | null
          created_at: string
          depends_on: string[]
          done_at: string | null
          due_date: string | null
          effort_hours: number | null
          evidence_note: string | null
          evidence_type: string | null
          goal_id: string
          id: string
          is_major: boolean
          key: string | null
          min_weeks: number | null
          position: number
          sources: Json
          stage: number
          status: string
          target_value: number | null
          title: string
          user_id: string
        }
        Insert: {
          actions?: Json
          blocked_reason?: string | null
          capability?: string | null
          cost?: number | null
          created_at?: string
          depends_on?: string[]
          done_at?: string | null
          due_date?: string | null
          effort_hours?: number | null
          evidence_note?: string | null
          evidence_type?: string | null
          goal_id: string
          id?: string
          is_major?: boolean
          key?: string | null
          min_weeks?: number | null
          position?: number
          sources?: Json
          stage?: number
          status?: string
          target_value?: number | null
          title: string
          user_id: string
        }
        Update: {
          actions?: Json
          blocked_reason?: string | null
          capability?: string | null
          cost?: number | null
          created_at?: string
          depends_on?: string[]
          done_at?: string | null
          due_date?: string | null
          effort_hours?: number | null
          evidence_note?: string | null
          evidence_type?: string | null
          goal_id?: string
          id?: string
          is_major?: boolean
          key?: string | null
          min_weeks?: number | null
          position?: number
          sources?: Json
          stage?: number
          status?: string
          target_value?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_milestones_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_missions: {
        Row: {
          blockers: Json
          checkpoint: Json
          contract: Json
          council: Json
          created_at: string
          experts: string[]
          goal_id: string | null
          history: Json
          id: string
          last_signal: Json | null
          last_signal_at: string | null
          metrics: Json
          options: Json
          state: string
          tier: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blockers?: Json
          checkpoint?: Json
          contract?: Json
          council?: Json
          created_at?: string
          experts?: string[]
          goal_id?: string | null
          history?: Json
          id?: string
          last_signal?: Json | null
          last_signal_at?: string | null
          metrics?: Json
          options?: Json
          state?: string
          tier?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          blockers?: Json
          checkpoint?: Json
          contract?: Json
          council?: Json
          created_at?: string
          experts?: string[]
          goal_id?: string | null
          history?: Json
          id?: string
          last_signal?: Json | null
          last_signal_at?: string | null
          metrics?: Json
          options?: Json
          state?: string
          tier?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      goal_reflections: {
        Row: {
          change_next: string | null
          created_at: string
          goal_id: string
          got_in_way: string | null
          id: string
          user_id: string
          went_well: string | null
        }
        Insert: {
          change_next?: string | null
          created_at?: string
          goal_id: string
          got_in_way?: string | null
          id?: string
          user_id: string
          went_well?: string | null
        }
        Update: {
          change_next?: string | null
          created_at?: string
          goal_id?: string
          got_in_way?: string | null
          id?: string
          user_id?: string
          went_well?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_reflections_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_reflections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          baseline_value: number | null
          budget_available: number | null
          completed_at: string | null
          created_at: string
          current_state: string | null
          current_value: number | null
          deadline: string | null
          dependencies: string[]
          domain: string
          id: string
          is_protected: boolean
          jurisdiction: string | null
          minimum_weekly_minutes: number
          monthly_saving: number | null
          pathway: Json | null
          preferred_days: number[] | null
          preferred_start: string | null
          preferred_time: string
          prerequisites: string | null
          priority: number
          priority_class: string | null
          session_minutes: number
          status: string
          success_definition: string | null
          success_type: string | null
          target_metric: string | null
          target_state: string | null
          target_unit: string | null
          target_value: number | null
          title: string
          user_id: string
          weekly_minutes: number
          why: string | null
        }
        Insert: {
          baseline_value?: number | null
          budget_available?: number | null
          completed_at?: string | null
          created_at?: string
          current_state?: string | null
          current_value?: number | null
          deadline?: string | null
          dependencies?: string[]
          domain?: string
          id?: string
          is_protected?: boolean
          jurisdiction?: string | null
          minimum_weekly_minutes?: number
          monthly_saving?: number | null
          pathway?: Json | null
          preferred_days?: number[] | null
          preferred_start?: string | null
          preferred_time?: string
          prerequisites?: string | null
          priority?: number
          priority_class?: string | null
          session_minutes?: number
          status?: string
          success_definition?: string | null
          success_type?: string | null
          target_metric?: string | null
          target_state?: string | null
          target_unit?: string | null
          target_value?: number | null
          title: string
          user_id: string
          weekly_minutes?: number
          why?: string | null
        }
        Update: {
          baseline_value?: number | null
          budget_available?: number | null
          completed_at?: string | null
          created_at?: string
          current_state?: string | null
          current_value?: number | null
          deadline?: string | null
          dependencies?: string[]
          domain?: string
          id?: string
          is_protected?: boolean
          jurisdiction?: string | null
          minimum_weekly_minutes?: number
          monthly_saving?: number | null
          pathway?: Json | null
          preferred_days?: number[] | null
          preferred_start?: string | null
          preferred_time?: string
          prerequisites?: string | null
          priority?: number
          priority_class?: string | null
          session_minutes?: number
          status?: string
          success_definition?: string | null
          success_type?: string | null
          target_metric?: string | null
          target_state?: string | null
          target_unit?: string | null
          target_value?: number | null
          title?: string
          user_id?: string
          weekly_minutes?: number
          why?: string | null
        }
        Relationships: []
      }
      guided_video_cache: {
        Row: {
          activity: string
          candidates: Json
          focus: string
          key: string
          minutes: number
          refreshed_at: string
        }
        Insert: {
          activity: string
          candidates?: Json
          focus: string
          key: string
          minutes: number
          refreshed_at?: string
        }
        Update: {
          activity?: string
          candidates?: Json
          focus?: string
          key?: string
          minutes?: number
          refreshed_at?: string
        }
        Relationships: []
      }
      health_connections: {
        Row: {
          categories: string[]
          created_at: string
          id: string
          last_received_at: string | null
          platform: string
          rejected_count: number
          revoked_at: string | null
          status: string
          token_hash: string
          updated_at: string
          user_id: string
          write_enabled: boolean
        }
        Insert: {
          categories?: string[]
          created_at?: string
          id?: string
          last_received_at?: string | null
          platform: string
          rejected_count?: number
          revoked_at?: string | null
          status?: string
          token_hash: string
          updated_at?: string
          user_id: string
          write_enabled?: boolean
        }
        Update: {
          categories?: string[]
          created_at?: string
          id?: string
          last_received_at?: string | null
          platform?: string
          rejected_count?: number
          revoked_at?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
          write_enabled?: boolean
        }
        Relationships: []
      }
      health_samples: {
        Row: {
          connection_id: string | null
          created_at: string
          end_at: string | null
          id: string
          is_deleted: boolean
          kind: string
          possible_duplicate: boolean
          provider_event_id: string | null
          provider_updated_at: string | null
          raw_hash: string | null
          recorded_at: string
          source: string
          source_device: string | null
          unit: string | null
          user_id: string
          value: number
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          is_deleted?: boolean
          kind: string
          possible_duplicate?: boolean
          provider_event_id?: string | null
          provider_updated_at?: string | null
          raw_hash?: string | null
          recorded_at: string
          source: string
          source_device?: string | null
          unit?: string | null
          user_id: string
          value: number
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          is_deleted?: boolean
          kind?: string
          possible_duplicate?: boolean
          provider_event_id?: string | null
          provider_updated_at?: string | null
          raw_hash?: string | null
          recorded_at?: string
          source?: string
          source_device?: string | null
          unit?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "health_samples_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "health_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          affected: string[]
          created_by: string | null
          id: string
          member_message: string
          resolved_at: string | null
          severity: string
          started_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          affected?: string[]
          created_by?: string | null
          id?: string
          member_message: string
          resolved_at?: string | null
          severity: string
          started_at?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          affected?: string[]
          created_by?: string | null
          id?: string
          member_message?: string
          resolved_at?: string | null
          severity?: string
          started_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      intelligence_events: {
        Row: {
          created_at: string
          detail: Json
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      internal_cron_tokens: {
        Row: {
          created_at: string
          name: string
          token: string
        }
        Insert: {
          created_at?: string
          name: string
          token: string
        }
        Update: {
          created_at?: string
          name?: string
          token?: string
        }
        Relationships: []
      }
      intervention_decisions: {
        Row: {
          allowed: boolean
          block_id: string | null
          channels: string[]
          created_at: string
          id: string
          kind: string
          policy_version: string
          reason: string
          user_id: string
        }
        Insert: {
          allowed: boolean
          block_id?: string | null
          channels?: string[]
          created_at?: string
          id?: string
          kind: string
          policy_version: string
          reason: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          block_id?: string | null
          channels?: string[]
          created_at?: string
          id?: string
          kind?: string
          policy_version?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intervention_decisions_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intervention_decisions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_events: {
        Row: {
          created_at: string
          detail: Json
          id: number
          journey_id: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          id?: never
          journey_id: string
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: never
          journey_id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_events_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
        ]
      }
      journeys: {
        Row: {
          appointment_id: string | null
          arrive_by: string
          buffer_min: number
          created_at: string
          dest_address: string
          dest_label: string | null
          dest_lat: number | null
          dest_lng: number | null
          distance_m: number | null
          duration_min: number
          id: string
          last_checked_at: string | null
          leave_at: string
          mode: string
          origin_address: string
          origin_label: string | null
          origin_lat: number | null
          origin_lng: number | null
          plan_block_id: string | null
          provider: string
          status: string
          traffic_aware: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          arrive_by: string
          buffer_min?: number
          created_at?: string
          dest_address: string
          dest_label?: string | null
          dest_lat?: number | null
          dest_lng?: number | null
          distance_m?: number | null
          duration_min: number
          id?: string
          last_checked_at?: string | null
          leave_at: string
          mode: string
          origin_address: string
          origin_label?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          plan_block_id?: string | null
          provider?: string
          status?: string
          traffic_aware?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          arrive_by?: string
          buffer_min?: number
          created_at?: string
          dest_address?: string
          dest_label?: string | null
          dest_lat?: number | null
          dest_lng?: number | null
          distance_m?: number | null
          duration_min?: number
          id?: string
          last_checked_at?: string | null
          leave_at?: string
          mode?: string
          origin_address?: string
          origin_label?: string | null
          origin_lat?: number | null
          origin_lng?: number | null
          plan_block_id?: string | null
          provider?: string
          status?: string
          traffic_aware?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journeys_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointment_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_plan_block_id_fkey"
            columns: ["plan_block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_id: string
          domain: string
          effective_date: string
          embedding: string | null
          embedding_model: string | null
          indexed_at: string
          source_id: string
          text_or_rule: string
          title: string
        }
        Insert: {
          chunk_id: string
          domain: string
          effective_date: string
          embedding?: string | null
          embedding_model?: string | null
          indexed_at?: string
          source_id: string
          text_or_rule: string
          title: string
        }
        Update: {
          chunk_id?: string
          domain?: string
          effective_date?: string
          embedding?: string | null
          embedding_model?: string | null
          indexed_at?: string
          source_id?: string
          text_or_rule?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          content_hash: string | null
          domain: string
          indexed_at: string
          jurisdiction: string
          last_reviewed: string
          published: string
          publisher: string
          retrieval_method: string
          review_cadence_months: number
          rights: string
          source_id: string
          storage_mode: string
          superseded_by: string | null
          title: string
          trust_tier: string
          url: string
        }
        Insert: {
          content_hash?: string | null
          domain: string
          indexed_at?: string
          jurisdiction: string
          last_reviewed: string
          published: string
          publisher: string
          retrieval_method: string
          review_cadence_months: number
          rights: string
          source_id: string
          storage_mode: string
          superseded_by?: string | null
          title: string
          trust_tier: string
          url: string
        }
        Update: {
          content_hash?: string | null
          domain?: string
          indexed_at?: string
          jurisdiction?: string
          last_reviewed?: string
          published?: string
          publisher?: string
          retrieval_method?: string
          review_cadence_months?: number
          rights?: string
          source_id?: string
          storage_mode?: string
          superseded_by?: string | null
          title?: string
          trust_tier?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      learning_assessments: {
        Row: {
          created_at: string
          due_on: string | null
          evidence: string | null
          goal_id: string
          id: string
          kind: string
          score: number | null
          taken_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_on?: string | null
          evidence?: string | null
          goal_id: string
          id?: string
          kind?: string
          score?: number | null
          taken_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_on?: string | null
          evidence?: string | null
          goal_id?: string
          id?: string
          kind?: string
          score?: number | null
          taken_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_assessments_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_assessments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_resources: {
        Row: {
          content: string | null
          created_at: string
          done_units: number
          goal_id: string
          id: string
          kind: string
          title: string
          total_units: number | null
          url: string | null
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          done_units?: number
          goal_id: string
          id?: string
          kind?: string
          title: string
          total_units?: number | null
          url?: string | null
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          done_units?: number
          goal_id?: string
          id?: string
          kind?: string
          title?: string
          total_units?: number | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_resources_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_resources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_searches: {
        Row: {
          created_at: string
          id: string
          level: string
          resources: Json
          subject: string
          summary: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: string
          resources?: Json
          subject: string
          summary?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: string
          resources?: Json
          subject?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: []
      }
      learning_topics: {
        Row: {
          created_at: string
          done_at: string | null
          goal_id: string
          id: string
          parent_id: string | null
          position: number
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          goal_id: string
          id?: string
          parent_id?: string | null
          position?: number
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          goal_id?: string
          id?: string
          parent_id?: string | null
          position?: number
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_topics_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_topics_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "learning_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string
          lesson_id: string
          reflection: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string
          lesson_id: string
          reflection?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string
          lesson_id?: string
          reflection?: string | null
          user_id?: string
        }
        Relationships: []
      }
      life_links: {
        Row: {
          created_at: string
          from_kind: string
          from_ref: string
          goal_id: string | null
          id: string
          invalidated_at: string | null
          link_key: string
          relation: string
          source: string
          to_kind: string
          to_ref: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_kind: string
          from_ref: string
          goal_id?: string | null
          id?: string
          invalidated_at?: string | null
          link_key: string
          relation: string
          source: string
          to_kind: string
          to_ref: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_kind?: string
          from_ref?: string
          goal_id?: string | null
          id?: string
          invalidated_at?: string | null
          link_key?: string
          relation?: string
          source?: string
          to_kind?: string
          to_ref?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "life_links_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      life_twin_facts: {
        Row: {
          confidence: number
          created_at: string
          domain: string
          fact_key: string
          fact_value: Json
          id: string
          is_locked: boolean
          observed_at: string
          source: string
          source_ref: string | null
          supersedes_id: string | null
          updated_at: string
          user_id: string
          valid_from: string
          valid_until: string | null
          version: number
        }
        Insert: {
          confidence?: number
          created_at?: string
          domain: string
          fact_key: string
          fact_value: Json
          id?: string
          is_locked?: boolean
          observed_at?: string
          source: string
          source_ref?: string | null
          supersedes_id?: string | null
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_until?: string | null
          version?: number
        }
        Update: {
          confidence?: number
          created_at?: string
          domain?: string
          fact_key?: string
          fact_value?: Json
          id?: string
          is_locked?: boolean
          observed_at?: string
          source?: string
          source_ref?: string | null
          supersedes_id?: string | null
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "life_twin_facts_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "life_twin_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "life_twin_facts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_photo_estimates: {
        Row: {
          corrections: string[]
          created_at: string
          eaten_on: string | null
          estimate: Json
          id: string
          logged_at: string | null
          meal_slot: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          corrections?: string[]
          created_at?: string
          eaten_on?: string | null
          estimate: Json
          id?: string
          logged_at?: string | null
          meal_slot?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          corrections?: string[]
          created_at?: string
          eaten_on?: string | null
          estimate?: Json
          id?: string
          logged_at?: string | null
          meal_slot?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      meal_plans: {
        Row: {
          created_at: string
          decision_note: string | null
          household: number
          id: string
          plan: Json
          policy_version: string
          prep_minutes: number
          status: string
          updated_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          created_at?: string
          decision_note?: string | null
          household?: number
          id?: string
          plan?: Json
          policy_version: string
          prep_minutes?: number
          status?: string
          updated_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          decision_note?: string | null
          household?: number
          id?: string
          plan?: Json
          policy_version?: string
          prep_minutes?: number
          status?: string
          updated_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_prep_preferences: {
        Row: {
          dislikes: string[]
          meals_per_day: string[]
          prep_weekday: number
          quick_breakfasts: boolean
          second_prep: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          dislikes?: string[]
          meals_per_day?: string[]
          prep_weekday?: number
          quick_breakfasts?: boolean
          second_prep?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          dislikes?: string[]
          meals_per_day?: string[]
          prep_weekday?: number
          quick_breakfasts?: boolean
          second_prep?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      movement_sessions: {
        Row: {
          completed: boolean
          created_at: string
          duration_min: number
          id: string
          kind: string
          level: number
          modality: string
          note: string | null
          pain_flag: boolean
          performed_on: string
          policy_version: string
          prescribed: Json
          rpe: number | null
          tolerance: string | null
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          duration_min: number
          id?: string
          kind: string
          level?: number
          modality: string
          note?: string | null
          pain_flag?: boolean
          performed_on?: string
          policy_version: string
          prescribed?: Json
          rpe?: number | null
          tolerance?: string | null
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          duration_min?: number
          id?: string
          kind?: string
          level?: number
          modality?: string
          note?: string | null
          pain_flag?: boolean
          performed_on?: string
          policy_version?: string
          prescribed?: Json
          rpe?: number | null
          tolerance?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movement_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          category: string
          email: boolean
          in_app: boolean
          push: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          email?: boolean
          in_app?: boolean
          push?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          email?: boolean
          in_app?: boolean
          push?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          attempts: number
          block_id: string | null
          body: string | null
          category: string
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          intent: string
          interaction: string | null
          interaction_at: string | null
          kind: string
          last_error: string | null
          link: string | null
          next_attempt_at: string | null
          plan_version_id: string | null
          provider_result: Json | null
          read_at: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          title: string
          user_id: string
        }
        Insert: {
          attempts?: number
          block_id?: string | null
          body?: string | null
          category?: string
          channel: string
          created_at?: string
          dedupe_key: string
          id?: string
          intent?: string
          interaction?: string | null
          interaction_at?: string | null
          kind?: string
          last_error?: string | null
          link?: string | null
          next_attempt_at?: string | null
          plan_version_id?: string | null
          provider_result?: Json | null
          read_at?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          title: string
          user_id: string
        }
        Update: {
          attempts?: number
          block_id?: string | null
          body?: string | null
          category?: string
          channel?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          intent?: string
          interaction?: string | null
          interaction_at?: string | null
          kind?: string
          last_error?: string | null
          link?: string | null
          next_attempt_at?: string | null
          plan_version_id?: string | null
          provider_result?: Json | null
          read_at?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_targets: {
        Row: {
          carbs_g: number
          confidence: string
          created_at: string
          explanation: string
          fat_g: number
          id: string
          inputs: Json
          kcal: number
          method: string
          protein_g: number
          status: string
          tdee: number
          user_id: string
        }
        Insert: {
          carbs_g: number
          confidence: string
          created_at?: string
          explanation: string
          fat_g: number
          id?: string
          inputs?: Json
          kcal: number
          method: string
          protein_g: number
          status?: string
          tdee: number
          user_id: string
        }
        Update: {
          carbs_g?: number
          confidence?: string
          created_at?: string
          explanation?: string
          fat_g?: number
          id?: string
          inputs?: Json
          kcal?: number
          method?: string
          protein_g?: number
          status?: string
          tdee?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_targets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_ledger: {
        Row: {
          block_id: string | null
          confidence: number
          created_at: string
          dedupe_key: string | null
          domain: string
          evidence_class: string
          goal_id: string | null
          id: string
          metadata: Json
          metric: string
          observation_refs: Json
          observed_at: string
          outcome_type: string
          plan_version_id: string | null
          policy_version: string | null
          source: string
          source_ref: string | null
          text_value: string | null
          unit: string | null
          user_id: string
          value: number | null
        }
        Insert: {
          block_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string | null
          domain: string
          evidence_class: string
          goal_id?: string | null
          id?: string
          metadata?: Json
          metric: string
          observation_refs?: Json
          observed_at?: string
          outcome_type?: string
          plan_version_id?: string | null
          policy_version?: string | null
          source: string
          source_ref?: string | null
          text_value?: string | null
          unit?: string | null
          user_id: string
          value?: number | null
        }
        Update: {
          block_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string | null
          domain?: string
          evidence_class?: string
          goal_id?: string | null
          id?: string
          metadata?: Json
          metric?: string
          observation_refs?: Json
          observed_at?: string
          outcome_type?: string
          plan_version_id?: string | null
          policy_version?: string | null
          source?: string
          source_ref?: string | null
          text_value?: string | null
          unit?: string | null
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_ledger_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_ledger_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_ledger_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_cohorts: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          rules: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          rules?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          rules?: Json
        }
        Relationships: []
      }
      owner_feedback: {
        Row: {
          category: string
          created_at: string
          created_by: string
          id: string
          linked_ref: string | null
          notes: string
          resolution: string | null
          severity: string
          source: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          created_by: string
          id?: string
          linked_ref?: string | null
          notes: string
          resolution?: string | null
          severity?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          linked_ref?: string | null
          notes?: string
          resolution?: string | null
          severity?: string
          source?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      owner_member_tags: {
        Row: {
          created_at: string
          created_by: string
          tag: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          tag: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          tag?: string
          user_id?: string
        }
        Relationships: []
      }
      owner_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          user_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          user_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          user_id?: string
        }
        Relationships: []
      }
      phone_numbers: {
        Row: {
          country: string
          created_at: string
          e164_enc: string
          last4: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          country: string
          created_at?: string
          e164_enc: string
          last4: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          e164_enc?: string
          last4?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      plan_block_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          block_id: string
          created_at: string
          event_type: string
          evidence_refs: Json
          from_status: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          missed_reason: string | null
          note: string | null
          occurred_at: string
          reason_code: string | null
          source_channel: string
          to_status: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          block_id: string
          created_at?: string
          event_type: string
          evidence_refs?: Json
          from_status?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          missed_reason?: string | null
          note?: string | null
          occurred_at?: string
          reason_code?: string | null
          source_channel?: string
          to_status: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          block_id?: string
          created_at?: string
          event_type?: string
          evidence_refs?: Json
          from_status?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          missed_reason?: string | null
          note?: string | null
          occurred_at?: string
          reason_code?: string | null
          source_channel?: string
          to_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_block_events_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_block_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_blocks: {
        Row: {
          call_requested: boolean
          commitment_id: string | null
          completed_at: string | null
          created_at: string
          domain: string
          duration_min: number
          evidence: string
          evidence_detail: Json
          goal_id: string | null
          id: string
          interruption_count: number
          is_protected: boolean
          note: string | null
          occurrence_kind: string
          original_starts_at: string
          plan_version_id: string | null
          source_ref: string | null
          source_type: string
          started_at: string | null
          starts_at: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          call_requested?: boolean
          commitment_id?: string | null
          completed_at?: string | null
          created_at?: string
          domain?: string
          duration_min: number
          evidence?: string
          evidence_detail?: Json
          goal_id?: string | null
          id?: string
          interruption_count?: number
          is_protected?: boolean
          note?: string | null
          occurrence_kind?: string
          original_starts_at?: string
          plan_version_id?: string | null
          source_ref?: string | null
          source_type?: string
          started_at?: string | null
          starts_at: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          call_requested?: boolean
          commitment_id?: string | null
          completed_at?: string | null
          created_at?: string
          domain?: string
          duration_min?: number
          evidence?: string
          evidence_detail?: Json
          goal_id?: string | null
          id?: string
          interruption_count?: number
          is_protected?: boolean
          note?: string | null
          occurrence_kind?: string
          original_starts_at?: string
          plan_version_id?: string | null
          source_ref?: string | null
          source_type?: string
          started_at?: string | null
          starts_at?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_blocks_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_blocks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_blocks_plan_version_id_fkey"
            columns: ["plan_version_id"]
            isOneToOne: false
            referencedRelation: "plan_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_property_locks: {
        Row: {
          created_at: string
          id: string
          label: string
          property: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          property: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          property?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_versions: {
        Row: {
          apply_mode: string | null
          approved_at: string | null
          created_at: string
          decision_note: string | null
          diff_summary: Json
          engine_versions: Json
          explanation: string | null
          feasibility: string
          id: string
          rationale: Json | null
          status: string
          trial_until: string | null
          trigger: string
          user_id: string
          version: number
          week_start: string
        }
        Insert: {
          apply_mode?: string | null
          approved_at?: string | null
          created_at?: string
          decision_note?: string | null
          diff_summary?: Json
          engine_versions?: Json
          explanation?: string | null
          feasibility?: string
          id?: string
          rationale?: Json | null
          status?: string
          trial_until?: string | null
          trigger?: string
          user_id: string
          version: number
          week_start: string
        }
        Update: {
          apply_mode?: string | null
          approved_at?: string | null
          created_at?: string
          decision_note?: string | null
          diff_summary?: Json
          engine_versions?: Json
          explanation?: string | null
          feasibility?: string
          id?: string
          rationale?: Json | null
          status?: string
          trial_until?: string | null
          trigger?: string
          user_id?: string
          version?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_versions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_messages: {
        Row: {
          author: string
          body: string
          created_at: string
          id: string
          share_id: string
          user_id: string
        }
        Insert: {
          author: string
          body: string
          created_at?: string
          id?: string
          share_id: string
          user_id: string
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          id?: string
          share_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_messages_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "professional_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_proposals: {
        Row: {
          commitment_id: string | null
          created_at: string
          decided_at: string | null
          detail: string | null
          id: string
          kind: string
          safety_reason: string | null
          schedule: Json | null
          share_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          commitment_id?: string | null
          created_at?: string
          decided_at?: string | null
          detail?: string | null
          id?: string
          kind: string
          safety_reason?: string | null
          schedule?: Json | null
          share_id: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          commitment_id?: string | null
          created_at?: string
          decided_at?: string | null
          detail?: string | null
          id?: string
          kind?: string
          safety_reason?: string | null
          schedule?: Json | null
          share_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_proposals_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_proposals_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "professional_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_shares: {
        Row: {
          accepted_at: string | null
          created_at: string
          credential_status: string
          health_consent: string[]
          id: string
          invite_expires_at: string | null
          invite_token_hash: string | null
          permissions: string[]
          professional_name: string
          professional_user_id: string | null
          revoked_at: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          credential_status?: string
          health_consent?: string[]
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          permissions?: string[]
          professional_name: string
          professional_user_id?: string | null
          revoked_at?: string | null
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          credential_status?: string
          health_consent?: string[]
          id?: string
          invite_expires_at?: string | null
          invite_token_hash?: string | null
          permissions?: string[]
          professional_name?: string
          professional_user_id?: string | null
          revoked_at?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          account_status: string
          accountability_level: string
          acquisition_source: string
          activity_level: string
          adaptive_daily_budget: number
          allergies: string[]
          billing_country: string | null
          billing_country_source: string | null
          calendar_token: string
          call_allowed_kinds: string[] | null
          call_consent_at: string | null
          call_consent_version: string | null
          call_due_enabled: boolean
          call_evening_enabled: boolean
          call_evening_time: string
          call_max_attempts: number
          call_max_minutes: number
          call_missed_enabled: boolean
          call_morning_enabled: boolean
          call_morning_time: string
          call_style: string | null
          call_time: string
          call_voicemail_policy: string
          calls_enabled: boolean
          calls_stopped_at: string | null
          coaching_style: string
          created_at: string
          date_of_birth: string | null
          diet_type: string
          display_name: string | null
          email_reminders: boolean
          enabled_domains: string[]
          health_token: string
          height_cm: number | null
          high_contrast: boolean
          id: string
          intended_use: string[]
          life_audit: Json
          nutrition_goal: string
          onboarded: boolean
          phone_number: string | null
          processing_restricted: boolean
          processing_restricted_at: string | null
          push_motivating: boolean
          push_muted_kinds: string[]
          quiet_end: string
          quiet_start: string
          reduce_motion: boolean
          reminder_lead_min: number
          reminders_enabled: boolean
          sex: string | null
          sleep_target_hours: number
          sleep_time: string
          text_size: string
          theme: string
          tier: string
          timezone: string
          units: string
          updated_at: string
          wake_time: string
          work_days: number[]
          work_end: string | null
          work_start: string | null
        }
        Insert: {
          account_status?: string
          accountability_level?: string
          acquisition_source?: string
          activity_level?: string
          adaptive_daily_budget?: number
          allergies?: string[]
          billing_country?: string | null
          billing_country_source?: string | null
          calendar_token?: string
          call_allowed_kinds?: string[] | null
          call_consent_at?: string | null
          call_consent_version?: string | null
          call_due_enabled?: boolean
          call_evening_enabled?: boolean
          call_evening_time?: string
          call_max_attempts?: number
          call_max_minutes?: number
          call_missed_enabled?: boolean
          call_morning_enabled?: boolean
          call_morning_time?: string
          call_style?: string | null
          call_time?: string
          call_voicemail_policy?: string
          calls_enabled?: boolean
          calls_stopped_at?: string | null
          coaching_style?: string
          created_at?: string
          date_of_birth?: string | null
          diet_type?: string
          display_name?: string | null
          email_reminders?: boolean
          enabled_domains?: string[]
          health_token?: string
          height_cm?: number | null
          high_contrast?: boolean
          id: string
          intended_use?: string[]
          life_audit?: Json
          nutrition_goal?: string
          onboarded?: boolean
          phone_number?: string | null
          processing_restricted?: boolean
          processing_restricted_at?: string | null
          push_motivating?: boolean
          push_muted_kinds?: string[]
          quiet_end?: string
          quiet_start?: string
          reduce_motion?: boolean
          reminder_lead_min?: number
          reminders_enabled?: boolean
          sex?: string | null
          sleep_target_hours?: number
          sleep_time?: string
          text_size?: string
          theme?: string
          tier?: string
          timezone?: string
          units?: string
          updated_at?: string
          wake_time?: string
          work_days?: number[]
          work_end?: string | null
          work_start?: string | null
        }
        Update: {
          account_status?: string
          accountability_level?: string
          acquisition_source?: string
          activity_level?: string
          adaptive_daily_budget?: number
          allergies?: string[]
          billing_country?: string | null
          billing_country_source?: string | null
          calendar_token?: string
          call_allowed_kinds?: string[] | null
          call_consent_at?: string | null
          call_consent_version?: string | null
          call_due_enabled?: boolean
          call_evening_enabled?: boolean
          call_evening_time?: string
          call_max_attempts?: number
          call_max_minutes?: number
          call_missed_enabled?: boolean
          call_morning_enabled?: boolean
          call_morning_time?: string
          call_style?: string | null
          call_time?: string
          call_voicemail_policy?: string
          calls_enabled?: boolean
          calls_stopped_at?: string | null
          coaching_style?: string
          created_at?: string
          date_of_birth?: string | null
          diet_type?: string
          display_name?: string | null
          email_reminders?: boolean
          enabled_domains?: string[]
          health_token?: string
          height_cm?: number | null
          high_contrast?: boolean
          id?: string
          intended_use?: string[]
          life_audit?: Json
          nutrition_goal?: string
          onboarded?: boolean
          phone_number?: string | null
          processing_restricted?: boolean
          processing_restricted_at?: string | null
          push_motivating?: boolean
          push_muted_kinds?: string[]
          quiet_end?: string
          quiet_start?: string
          reduce_motion?: boolean
          reminder_lead_min?: number
          reminders_enabled?: boolean
          sex?: string | null
          sleep_target_hours?: number
          sleep_time?: string
          text_size?: string
          theme?: string
          tier?: string
          timezone?: string
          units?: string
          updated_at?: string
          wake_time?: string
          work_days?: number[]
          work_end?: string | null
          work_start?: string | null
        }
        Relationships: []
      }
      programme_prescriptions: {
        Row: {
          created_at: string
          day_index: number
          exercise_key: string
          id: string
          load_kg: number | null
          order_index: number
          programme_id: string
          rep_max: number
          rep_min: number
          rest_sec: number
          revision: number
          rir_target: number
          sets: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_index: number
          exercise_key: string
          id?: string
          load_kg?: number | null
          order_index: number
          programme_id: string
          rep_max: number
          rep_min: number
          rest_sec: number
          revision?: number
          rir_target: number
          sets: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_index?: number
          exercise_key?: string
          id?: string
          load_kg?: number | null
          order_index?: number
          programme_id?: string
          rep_max?: number
          rep_min?: number
          rest_sec?: number
          revision?: number
          rir_target?: number
          sets?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_prescriptions_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "training_programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_prescriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      progression_events: {
        Row: {
          created_at: string
          evidence: Json
          id: string
          next: Json
          prescription_id: string
          prior: Json
          rule: string
          user_id: string
        }
        Insert: {
          created_at?: string
          evidence?: Json
          id?: string
          next: Json
          prescription_id: string
          prior: Json
          rule: string
          user_id: string
        }
        Update: {
          created_at?: string
          evidence?: Json
          id?: string
          next?: Json
          prescription_id?: string
          prior?: Json
          rule?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "progression_events_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "programme_prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progression_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_calls: {
        Row: {
          created_at: string
          id: number
          latency_ms: number
          ok: boolean
          provider: string
          status: number | null
        }
        Insert: {
          created_at?: string
          id?: never
          latency_ms: number
          ok: boolean
          provider: string
          status?: number | null
        }
        Update: {
          created_at?: string
          id?: never
          latency_ms?: number
          ok?: boolean
          provider?: string
          status?: number | null
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          created_at: string
          device_name: string | null
          id: string
          last_seen_at: string
          platform: string
          status: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform: string
          status?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_name?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          status?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      recovery_checkins: {
        Row: {
          check_date: string
          created_at: string
          energy: number
          id: string
          ill_or_injured: boolean
          note: string | null
          readiness: number
          recovery_version: string | null
          sleep_quality: number
          soreness: number
          stress: number
          user_id: string
        }
        Insert: {
          check_date?: string
          created_at?: string
          energy: number
          id?: string
          ill_or_injured?: boolean
          note?: string | null
          readiness: number
          recovery_version?: string | null
          sleep_quality: number
          soreness: number
          stress: number
          user_id: string
        }
        Update: {
          check_date?: string
          created_at?: string
          energy?: number
          id?: string
          ill_or_injured?: boolean
          note?: string | null
          readiness?: number
          recovery_version?: string | null
          sleep_quality?: number
          soreness?: number
          stress?: number
          user_id?: string
        }
        Relationships: []
      }
      research_findings: {
        Row: {
          applied_at: string | null
          category: string
          created_at: string
          id: string
          quote: string
          research_id: string
          source_id: string
          statement: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          category: string
          created_at?: string
          id?: string
          quote: string
          research_id: string
          source_id: string
          statement: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          category?: string
          created_at?: string
          id?: string
          quote?: string
          research_id?: string
          source_id?: string
          statement?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_findings_research_id_fkey"
            columns: ["research_id"]
            isOneToOne: false
            referencedRelation: "career_research"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_findings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "research_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_findings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      research_sources: {
        Row: {
          content_excerpt: string | null
          id: string
          publisher: string
          research_id: string
          retrieved_at: string
          title: string | null
          trust: string
          url: string
          user_id: string
        }
        Insert: {
          content_excerpt?: string | null
          id?: string
          publisher: string
          research_id: string
          retrieved_at?: string
          title?: string | null
          trust: string
          url: string
          user_id: string
        }
        Update: {
          content_excerpt?: string | null
          id?: string
          publisher?: string
          research_id?: string
          retrieved_at?: string
          title?: string | null
          trust?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_sources_research_id_fkey"
            columns: ["research_id"]
            isOneToOne: false
            referencedRelation: "career_research"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_sources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_runs: {
        Row: {
          id: string
          ran_at: string
          removed: Json
        }
        Insert: {
          id?: string
          ran_at?: string
          removed?: Json
        }
        Update: {
          id?: string
          ran_at?: string
          removed?: Json
        }
        Relationships: []
      }
      retrieval_items: {
        Row: {
          answer: string
          created_at: string
          due_on: string
          generated: boolean
          goal_id: string
          id: string
          interval_step: number
          policy_version: string
          prompt: string
          resource_id: string | null
          topic_id: string | null
          user_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          due_on?: string
          generated?: boolean
          goal_id: string
          id?: string
          interval_step?: number
          policy_version?: string
          prompt: string
          resource_id?: string | null
          topic_id?: string | null
          user_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          due_on?: string
          generated?: boolean
          goal_id?: string
          id?: string
          interval_step?: number
          policy_version?: string
          prompt?: string
          resource_id?: string | null
          topic_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retrieval_items_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "learning_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retrieval_items_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "learning_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retrieval_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      retrieval_reviews: {
        Row: {
          correct: boolean
          from_step: number
          id: string
          item_id: string
          next_due: string
          policy_version: string
          reviewed_at: string
          to_step: number
          user_id: string
        }
        Insert: {
          correct: boolean
          from_step: number
          id?: string
          item_id: string
          next_due: string
          policy_version: string
          reviewed_at?: string
          to_step: number
          user_id: string
        }
        Update: {
          correct?: boolean
          from_step?: number
          id?: string
          item_id?: string
          next_due?: string
          policy_version?: string
          reviewed_at?: string
          to_step?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retrieval_reviews_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "retrieval_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retrieval_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_events: {
        Row: {
          created_at: string
          domain: string
          id: string
          intervention: string
          policy_version: string
          signals: string[]
          stage: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          intervention: string
          policy_version: string
          signals?: string[]
          stage: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          intervention?: string
          policy_version?: string
          signals?: string[]
          stage?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_flags: {
        Row: {
          cleared_at: string | null
          id: string
          raised_at: string
          signal: string
          source_event_id: string | null
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          id?: string
          raised_at?: string
          signal: string
          source_event_id?: string | null
          user_id: string
        }
        Update: {
          cleared_at?: string | null
          id?: string
          raised_at?: string
          signal?: string
          source_event_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_flags_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "safety_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_flags_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_meals: {
        Row: {
          created_at: string
          id: string
          items: Json
          kind: string
          name: string
          servings: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items?: Json
          kind?: string
          name: string
          servings?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          kind?: string
          name?: string
          servings?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_meals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          address: string
          created_at: string
          id: string
          label: string
          lat: number | null
          lng: number | null
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          label: string
          lat?: number | null
          lng?: number | null
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          label?: string
          lat?: number | null
          lng?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_places_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_calls: {
        Row: {
          call_at: string
          campaign_id: string | null
          commitment_id: string | null
          created_at: string
          dedupe_key: string
          id: string
          processed_at: string | null
          purpose: string
          source: string
          source_ref: string | null
          status: string
          status_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          call_at: string
          campaign_id?: string | null
          commitment_id?: string | null
          created_at?: string
          dedupe_key: string
          id?: string
          processed_at?: string | null
          purpose: string
          source?: string
          source_ref?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          call_at?: string
          campaign_id?: string | null
          commitment_id?: string | null
          created_at?: string
          dedupe_key?: string
          id?: string
          processed_at?: string | null
          purpose?: string
          source?: string
          source_ref?: string | null
          status?: string
          status_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "call_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_calls_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_calls_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      spend_ledger: {
        Row: {
          created_at: string
          feature: string
          funded_by: string
          id: string
          kind: string
          period_start: string
          provider_cost_micro: number
          ref: string | null
          retail_micro: number
          user_id: string
        }
        Insert: {
          created_at?: string
          feature: string
          funded_by: string
          id?: string
          kind: string
          period_start: string
          provider_cost_micro: number
          ref?: string | null
          retail_micro: number
          user_id: string
        }
        Update: {
          created_at?: string
          feature?: string
          funded_by?: string
          id?: string
          kind?: string
          period_start?: string
          provider_cost_micro?: number
          ref?: string | null
          retail_micro?: number
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean
          current_period_end: string | null
          current_period_start: string | null
          customer_id: string | null
          provider: string
          status: string
          subscription_id: string | null
          tier: string
          trial_ends_at: string | null
          trial_used: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string | null
          provider?: string
          status?: string
          subscription_id?: string | null
          tier?: string
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string | null
          provider?: string
          status?: string
          subscription_id?: string | null
          tier?: string
          trial_ends_at?: string | null
          trial_used?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_requests: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          diagnostics: Json | null
          id: string
          message: string
          priority: string
          resolution: string | null
          resolved_at: string | null
          severity: string
          status: string
          target_label: string
          tier: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          diagnostics?: Json | null
          id?: string
          message: string
          priority: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          target_label: string
          tier: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          diagnostics?: Json | null
          id?: string
          message?: string
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          target_label?: string
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      training_programmes: {
        Row: {
          created_at: string
          days_per_week: number
          equipment: string
          experience: string
          goal: string
          id: string
          policy_version: string
          session_minutes: number
          status: string
          template_key: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          days_per_week: number
          equipment: string
          experience: string
          goal: string
          id?: string
          policy_version: string
          session_minutes: number
          status?: string
          template_key: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          days_per_week?: number
          equipment?: string
          experience?: string
          goal?: string
          id?: string
          policy_version?: string
          session_minutes?: number
          status?: string
          template_key?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_programmes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          feature: string
          id: number
          market: string
          ok: boolean
          platform: string
          provider: string
          quantity: number
          service_month: string
          tier: string
          unit: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          feature: string
          id?: never
          market?: string
          ok?: boolean
          platform?: string
          provider: string
          quantity: number
          service_month: string
          tier?: string
          unit: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          feature?: string
          id?: never
          market?: string
          ok?: boolean
          platform?: string
          provider?: string
          quantity?: number
          service_month?: string
          tier?: string
          unit?: string
          user_id?: string | null
        }
        Relationships: []
      }
      usage_reservations: {
        Row: {
          actual_seconds: number
          actual_topup_seconds: number
          campaign_id: string | null
          created_at: string
          credit_micro: number
          expires_at: string
          id: string
          included_micro: number
          included_seconds: number
          kind: string
          period_start: string
          ref: string
          settled: boolean
          topup_seconds: number
          user_id: string
        }
        Insert: {
          actual_seconds?: number
          actual_topup_seconds?: number
          campaign_id?: string | null
          created_at?: string
          credit_micro?: number
          expires_at?: string
          id?: string
          included_micro?: number
          included_seconds?: number
          kind: string
          period_start: string
          ref: string
          settled?: boolean
          topup_seconds?: number
          user_id: string
        }
        Update: {
          actual_seconds?: number
          actual_topup_seconds?: number
          campaign_id?: string | null
          created_at?: string
          credit_micro?: number
          expires_at?: string
          id?: string
          included_micro?: number
          included_seconds?: number
          kind?: string
          period_start?: string
          ref?: string
          settled?: boolean
          topup_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_foods: {
        Row: {
          allergens: string[]
          barcode: string | null
          brand: string | null
          carbs_100g: number
          created_at: string
          fat_100g: number
          favourite: boolean
          fibre_100g: number | null
          id: string
          kcal_100g: number
          last_used_at: string
          name: string
          protein_100g: number
          serving_g: number | null
          serving_label: string | null
          source: string
          source_ref: string | null
          user_id: string
        }
        Insert: {
          allergens?: string[]
          barcode?: string | null
          brand?: string | null
          carbs_100g: number
          created_at?: string
          fat_100g: number
          favourite?: boolean
          fibre_100g?: number | null
          id?: string
          kcal_100g: number
          last_used_at?: string
          name: string
          protein_100g: number
          serving_g?: number | null
          serving_label?: string | null
          source: string
          source_ref?: string | null
          user_id: string
        }
        Update: {
          allergens?: string[]
          barcode?: string | null
          brand?: string | null
          carbs_100g?: number
          created_at?: string
          fat_100g?: number
          favourite?: boolean
          fibre_100g?: number | null
          id?: string
          kcal_100g?: number
          last_used_at?: string
          name?: string
          protein_100g?: number
          serving_g?: number | null
          serving_label?: string | null
          source?: string
          source_ref?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_foods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wearable_connections: {
        Row: {
          created_at: string
          error_count: number
          external_user_id: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          scopes: string[]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_count?: number
          external_user_id?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          scopes?: string[]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_count?: number
          external_user_id?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          scopes?: string[]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wearable_credentials: {
        Row: {
          access_token: string | null
          connection_id: string
          created_at: string
          expires_at: string | null
          pkce_verifier: string | null
          refresh_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          connection_id: string
          created_at?: string
          expires_at?: string | null
          pkce_verifier?: string | null
          refresh_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          connection_id?: string
          created_at?: string
          expires_at?: string | null
          pkce_verifier?: string | null
          refresh_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wearable_credentials_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "wearable_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_preferences: {
        Row: {
          allow_auto_move: boolean
          enabled: boolean
          experience: string
          guidance: string
          max_minutes: number
          min_minutes: number
          preferred_time: string
          reminders: boolean
          session_types: string[]
          sessions_per_week: number
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_auto_move?: boolean
          enabled?: boolean
          experience?: string
          guidance?: string
          max_minutes?: number
          min_minutes?: number
          preferred_time?: string
          reminders?: boolean
          session_types?: string[]
          sessions_per_week?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_auto_move?: boolean
          enabled?: boolean
          experience?: string
          guidance?: string
          max_minutes?: number
          min_minutes?: number
          preferred_time?: string
          reminders?: boolean
          session_types?: string[]
          sessions_per_week?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellness_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wellness_sessions: {
        Row: {
          activity: string
          actual_minutes: number
          block_id: string | null
          calm_after: number | null
          calm_before: number | null
          client_id: string | null
          completion_state: string
          created_at: string
          feedback: string | null
          focus: string | null
          id: string
          note: string | null
          planned_minutes: number
          rule_version: string
          safety_flag: boolean
          script_key: string
          session_type: string
          useful: number | null
          user_id: string
          video: Json | null
        }
        Insert: {
          activity?: string
          actual_minutes: number
          block_id?: string | null
          calm_after?: number | null
          calm_before?: number | null
          client_id?: string | null
          completion_state: string
          created_at?: string
          feedback?: string | null
          focus?: string | null
          id?: string
          note?: string | null
          planned_minutes: number
          rule_version: string
          safety_flag?: boolean
          script_key: string
          session_type: string
          useful?: number | null
          user_id: string
          video?: Json | null
        }
        Update: {
          activity?: string
          actual_minutes?: number
          block_id?: string | null
          calm_after?: number | null
          calm_before?: number | null
          client_id?: string | null
          completion_state?: string
          created_at?: string
          feedback?: string | null
          focus?: string | null
          id?: string
          note?: string | null
          planned_minutes?: number
          rule_version?: string
          safety_flag?: boolean
          script_key?: string
          session_type?: string
          useful?: number | null
          user_id?: string
          video?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "wellness_sessions_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellness_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sessions: {
        Row: {
          block_id: string | null
          completed_at: string | null
          day_index: number | null
          id: string
          note: string | null
          programme_id: string | null
          recovery_state: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          block_id?: string | null
          completed_at?: string | null
          day_index?: number | null
          id?: string
          note?: string | null
          programme_id?: string | null
          recovery_state?: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          block_id?: string | null
          completed_at?: string | null
          day_index?: number | null
          id?: string
          note?: string | null
          programme_id?: string | null
          recovery_state?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workout_sessions_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "plan_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sessions_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "training_programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_sets: {
        Row: {
          client_op_id: string | null
          client_recorded_at: string | null
          created_at: string
          exercise: string
          id: string
          performed_on: string
          prescription_id: string | null
          reps: number
          rir: number | null
          rpe: number | null
          session_id: string | null
          set_number: number | null
          user_id: string
          weight_kg: number
        }
        Insert: {
          client_op_id?: string | null
          client_recorded_at?: string | null
          created_at?: string
          exercise: string
          id?: string
          performed_on?: string
          prescription_id?: string | null
          reps: number
          rir?: number | null
          rpe?: number | null
          session_id?: string | null
          set_number?: number | null
          user_id: string
          weight_kg?: number
        }
        Update: {
          client_op_id?: string | null
          client_recorded_at?: string | null
          created_at?: string
          exercise?: string
          id?: string
          performed_on?: string
          prescription_id?: string | null
          reps?: number
          rir?: number | null
          rpe?: number | null
          session_id?: string | null
          set_number?: number | null
          user_id?: string
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "workout_sets_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "programme_prescriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_sets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_retention: { Args: never; Returns: Json }
      charge_reserved_call: {
        Args: {
          _cost: number
          _feature: string
          _part: string
          _ref: string
          _user: string
        }
        Returns: string
      }
      charge_spend: {
        Args: {
          _allow_credit: boolean
          _allowance: number
          _cost: number
          _feature: string
          _kind: string
          _period: string
          _ref: string
          _retail: number
          _user: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hit_rate_limit: {
        Args: { _bucket: string; _max: number; _window_seconds: number }
        Returns: boolean
      }
      match_knowledge: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          chunk_id: string
          similarity: number
        }[]
      }
      owner_analytics: { Args: { _from: string; _to: string }; Returns: Json }
      owner_cohort_metrics: { Args: { _rules: Json }; Returns: Json }
      owner_intelligence: {
        Args: { _from: string; _to: string }
        Returns: Json
      }
      owner_overview: { Args: { _from: string; _to: string }; Returns: Json }
      reserve_ai_budget: {
        Args: {
          _day: string
          _in: number
          _max_in: number
          _max_out: number
          _out: number
          _user_id: string
        }
        Returns: boolean
      }
      reserve_call_usage: {
        Args: {
          _campaign: string
          _end: string
          _micro_per_second: number
          _period: string
          _ref: string
          _seconds: number
          _start: string
          _user: string
        }
        Returns: Json
      }
      reserve_paid_ai: {
        Args: { _cost: number; _period: string; _ref: string; _user: string }
        Returns: string
      }
      settle_call_usage: {
        Args: { _ref: string; _seconds: number }
        Returns: undefined
      }
      settle_paid_ai: {
        Args: { _cost: number; _feature: string; _id: string; _retail: number }
        Returns: undefined
      }
      usage_summary: {
        Args: { _month: string }
        Returns: {
          events: number
          failed: number
          feature: string
          market: string
          members: number
          platform: string
          provider: string
          quantity: number
          tier: string
          unit: string
        }[]
      }
      verify_cron_token: { Args: { p_token: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
