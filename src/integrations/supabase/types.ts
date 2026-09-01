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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_interviews: {
        Row: {
          application_id: string
          created_at: string
          culture_org_score: number
          culture_role_score: number
          id: string
          jd_match_score: number
          skillset_score: number
          summary: string | null
          transcript: Json
        }
        Insert: {
          application_id: string
          created_at?: string
          culture_org_score?: number
          culture_role_score?: number
          id?: string
          jd_match_score?: number
          skillset_score?: number
          summary?: string | null
          transcript?: Json
        }
        Update: {
          application_id?: string
          created_at?: string
          culture_org_score?: number
          culture_role_score?: number
          id?: string
          jd_match_score?: number
          skillset_score?: number
          summary?: string | null
          transcript?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string
          candidate_id: string
          id: string
          requisition_id: string
          source: string
          stage: Database["public"]["Enums"]["app_stage"]
        }
        Insert: {
          applied_at?: string
          candidate_id: string
          id?: string
          requisition_id: string
          source?: string
          stage?: Database["public"]["Enums"]["app_stage"]
        }
        Update: {
          applied_at?: string
          candidate_id?: string
          id?: string
          requisition_id?: string
          source?: string
          stage?: Database["public"]["Enums"]["app_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          consent_given: boolean
          created_at: string
          current_ctc: number | null
          education: string | null
          email: string
          expected_ctc: number | null
          experience_years: number
          external_id: string | null
          external_provider: string | null
          full_name: string
          github_url: string | null
          id: string
          linkedin_url: string | null
          location: string | null
          notice_period_days: number | null
          phone: string | null
          resume_text: string | null
          skills: string[]
          source: string
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          consent_given?: boolean
          created_at?: string
          current_ctc?: number | null
          education?: string | null
          email: string
          expected_ctc?: number | null
          experience_years?: number
          external_id?: string | null
          external_provider?: string | null
          full_name: string
          github_url?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          notice_period_days?: number | null
          phone?: string | null
          resume_text?: string | null
          skills?: string[]
          source?: string
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          consent_given?: boolean
          created_at?: string
          current_ctc?: number | null
          education?: string | null
          email?: string
          expected_ctc?: number | null
          experience_years?: number
          external_id?: string | null
          external_provider?: string | null
          full_name?: string
          github_url?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          notice_period_days?: number | null
          phone?: string | null
          resume_text?: string | null
          skills?: string[]
          source?: string
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          budgeted_cost: number
          budgeted_headcount: number
          created_at: string
          head_name: string | null
          id: string
          name: string
          period: string
        }
        Insert: {
          budgeted_cost?: number
          budgeted_headcount?: number
          created_at?: string
          head_name?: string | null
          id?: string
          name: string
          period?: string
        }
        Update: {
          budgeted_cost?: number
          budgeted_headcount?: number
          created_at?: string
          head_name?: string | null
          id?: string
          name?: string
          period?: string
        }
        Relationships: []
      }
      evaluations: {
        Row: {
          application_id: string
          comments: string | null
          created_at: string
          evaluator: string | null
          focus_area: string | null
          id: string
          level: number
          rating: number | null
          recommendation: Database["public"]["Enums"]["recommendation"]
        }
        Insert: {
          application_id: string
          comments?: string | null
          created_at?: string
          evaluator?: string | null
          focus_area?: string | null
          id?: string
          level: number
          rating?: number | null
          recommendation?: Database["public"]["Enums"]["recommendation"]
        }
        Update: {
          application_id?: string
          comments?: string | null
          created_at?: string
          evaluator?: string | null
          focus_area?: string | null
          id?: string
          level?: number
          rating?: number | null
          recommendation?: Database["public"]["Enums"]["recommendation"]
        }
        Relationships: [
          {
            foreignKeyName: "evaluations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          integration_id: string
          secrets: Json
          updated_at: string
        }
        Insert: {
          integration_id: string
          secrets?: Json
          updated_at?: string
        }
        Update: {
          integration_id?: string
          secrets?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "source_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          application_id: string
          created_at: string
          id: string
          interviewer: string | null
          level: number
          scheduled_at: string | null
          status: string
          teams_link: string | null
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          interviewer?: string | null
          level?: number
          scheduled_at?: string | null
          status?: string
          teams_link?: string | null
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          interviewer?: string | null
          level?: number
          scheduled_at?: string | null
          status?: string
          teams_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_descriptions: {
        Row: {
          approver_comment: string | null
          created_at: string
          full_text: string | null
          good_to_have: string[]
          id: string
          must_have: string[]
          purpose: string | null
          qualifications: string | null
          reporting_to: string | null
          requisition_id: string
          responsibilities: string | null
          status: Database["public"]["Enums"]["jd_status"]
          success_factors: string | null
          version: number
        }
        Insert: {
          approver_comment?: string | null
          created_at?: string
          full_text?: string | null
          good_to_have?: string[]
          id?: string
          must_have?: string[]
          purpose?: string | null
          qualifications?: string | null
          reporting_to?: string | null
          requisition_id: string
          responsibilities?: string | null
          status?: Database["public"]["Enums"]["jd_status"]
          success_factors?: string | null
          version?: number
        }
        Update: {
          approver_comment?: string | null
          created_at?: string
          full_text?: string | null
          good_to_have?: string[]
          id?: string
          must_have?: string[]
          purpose?: string | null
          qualifications?: string | null
          reporting_to?: string | null
          requisition_id?: string
          responsibilities?: string | null
          status?: Database["public"]["Enums"]["jd_status"]
          success_factors?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_descriptions_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "requisitions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_scores: {
        Row: {
          application_id: string
          computed_at: string
          education_score: number
          experience_score: number
          id: string
          matched_skills: string[]
          missing_skills: string[]
          model: string | null
          overall_score: number
          override_reason: string | null
          rationale: string | null
          recommendation: Database["public"]["Enums"]["recommendation"] | null
          recruiter_override:
            | Database["public"]["Enums"]["recommendation"]
            | null
          risk_flags: string[]
          skills_score: number
          social_score: number
          weights: Json
        }
        Insert: {
          application_id: string
          computed_at?: string
          education_score?: number
          experience_score?: number
          id?: string
          matched_skills?: string[]
          missing_skills?: string[]
          model?: string | null
          overall_score?: number
          override_reason?: string | null
          rationale?: string | null
          recommendation?: Database["public"]["Enums"]["recommendation"] | null
          recruiter_override?:
            | Database["public"]["Enums"]["recommendation"]
            | null
          risk_flags?: string[]
          skills_score?: number
          social_score?: number
          weights?: Json
        }
        Update: {
          application_id?: string
          computed_at?: string
          education_score?: number
          experience_score?: number
          id?: string
          matched_skills?: string[]
          missing_skills?: string[]
          model?: string | null
          overall_score?: number
          override_reason?: string | null
          rationale?: string | null
          recommendation?: Database["public"]["Enums"]["recommendation"] | null
          recruiter_override?:
            | Database["public"]["Enums"]["recommendation"]
            | null
          risk_flags?: string[]
          skills_score?: number
          social_score?: number
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "match_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          application_id: string
          approval_trail: Json
          created_at: string
          id: string
          joining_date: string | null
          offered_ctc: number
          status: Database["public"]["Enums"]["offer_status"]
        }
        Insert: {
          application_id: string
          approval_trail?: Json
          created_at?: string
          id?: string
          joining_date?: string | null
          offered_ctc?: number
          status?: Database["public"]["Enums"]["offer_status"]
        }
        Update: {
          application_id?: string
          approval_trail?: Json
          created_at?: string
          id?: string
          joining_date?: string | null
          offered_ctc?: number
          status?: Database["public"]["Enums"]["offer_status"]
        }
        Relationships: [
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      requisitions: {
        Row: {
          approval_trail: Json
          budget_ctc: number
          code: string
          created_at: string
          department_id: string | null
          education_requirement: string | null
          experience_max: number
          experience_min: number
          good_to_have_skills: string[]
          hiring_manager: string | null
          id: string
          location: string | null
          must_have_skills: string[]
          opened_at: string
          openings: number
          req_type: Database["public"]["Enums"]["req_type"]
          responsibilities: string | null
          status: Database["public"]["Enums"]["req_status"]
          title: string
          weight_education: number
          weight_experience: number
          weight_skills: number
          weight_social: number
        }
        Insert: {
          approval_trail?: Json
          budget_ctc?: number
          code: string
          created_at?: string
          department_id?: string | null
          education_requirement?: string | null
          experience_max?: number
          experience_min?: number
          good_to_have_skills?: string[]
          hiring_manager?: string | null
          id?: string
          location?: string | null
          must_have_skills?: string[]
          opened_at?: string
          openings?: number
          req_type?: Database["public"]["Enums"]["req_type"]
          responsibilities?: string | null
          status?: Database["public"]["Enums"]["req_status"]
          title: string
          weight_education?: number
          weight_experience?: number
          weight_skills?: number
          weight_social?: number
        }
        Update: {
          approval_trail?: Json
          budget_ctc?: number
          code?: string
          created_at?: string
          department_id?: string | null
          education_requirement?: string | null
          experience_max?: number
          experience_min?: number
          good_to_have_skills?: string[]
          hiring_manager?: string | null
          id?: string
          location?: string | null
          must_have_skills?: string[]
          opened_at?: string
          openings?: number
          req_type?: Database["public"]["Enums"]["req_type"]
          responsibilities?: string | null
          status?: Database["public"]["Enums"]["req_status"]
          title?: string
          weight_education?: number
          weight_experience?: number
          weight_skills?: number
          weight_social?: number
        }
        Relationships: [
          {
            foreignKeyName: "requisitions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      social_profiles: {
        Row: {
          candidate_id: string
          fetched_at: string
          handle: string | null
          id: string
          profile_url: string | null
          provider: string
          rationale: string | null
          raw: Json | null
          score: number
          signals: Json
          status: string
        }
        Insert: {
          candidate_id: string
          fetched_at?: string
          handle?: string | null
          id?: string
          profile_url?: string | null
          provider: string
          rationale?: string | null
          raw?: Json | null
          score?: number
          signals?: Json
          status?: string
        }
        Update: {
          candidate_id?: string
          fetched_at?: string
          handle?: string | null
          id?: string
          profile_url?: string | null
          provider?: string
          rationale?: string | null
          raw?: Json | null
          score?: number
          signals?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_profiles_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      source_integrations: {
        Row: {
          config: Json
          created_at: string
          credential_fields: string[]
          enabled: boolean
          has_credentials: boolean
          id: string
          label: string
          last_test_message: string | null
          last_test_status: string
          last_tested_at: string | null
          provider: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          credential_fields?: string[]
          enabled?: boolean
          has_credentials?: boolean
          id?: string
          label: string
          last_test_message?: string | null
          last_test_status?: string
          last_tested_at?: string | null
          provider: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          credential_fields?: string[]
          enabled?: boolean
          has_credentials?: boolean
          id?: string
          label?: string
          last_test_message?: string | null
          last_test_status?: string
          last_tested_at?: string | null
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "recruiter"
        | "hiring_manager"
        | "department_head"
        | "hr_head"
        | "president_cbo"
      app_stage:
        | "applied"
        | "ai_screened"
        | "shortlisted"
        | "l1"
        | "l2"
        | "l3"
        | "offer"
        | "hired"
        | "rejected"
      jd_status: "draft" | "pending_dh" | "approved" | "changes_requested"
      offer_status:
        | "draft"
        | "pending_hr"
        | "pending_cbo"
        | "approved"
        | "released"
        | "accepted"
        | "declined"
        | "revoked"
      recommendation: "select" | "reject" | "hold"
      req_status:
        | "draft"
        | "pending_dh"
        | "pending_hr"
        | "pending_cbo"
        | "approved"
        | "rejected"
        | "on_hold"
        | "closed"
      req_type: "new" | "replacement"
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
      app_role: [
        "recruiter",
        "hiring_manager",
        "department_head",
        "hr_head",
        "president_cbo",
      ],
      app_stage: [
        "applied",
        "ai_screened",
        "shortlisted",
        "l1",
        "l2",
        "l3",
        "offer",
        "hired",
        "rejected",
      ],
      jd_status: ["draft", "pending_dh", "approved", "changes_requested"],
      offer_status: [
        "draft",
        "pending_hr",
        "pending_cbo",
        "approved",
        "released",
        "accepted",
        "declined",
        "revoked",
      ],
      recommendation: ["select", "reject", "hold"],
      req_status: [
        "draft",
        "pending_dh",
        "pending_hr",
        "pending_cbo",
        "approved",
        "rejected",
        "on_hold",
        "closed",
      ],
      req_type: ["new", "replacement"],
    },
  },
} as const
