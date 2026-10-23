
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "announcement_reads": {
                  Row: {
                    "announcement_id": string,"building_id": string,"created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "announcement_id": string,"building_id"?: string,"created_at"?: string,"user_id": string
                  }
                  Update: {
                    "announcement_id"?: string,"building_id"?: string,"created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcement_reads_announcement_id_fkey"
      columns: ["announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "announcement_reads_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "author_id": string | null,"body": string,"building_id": string,"created_at": string,"expires_at": string | null,"id": string,"pinned": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body"?: string,"building_id"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"pinned"?: boolean,"title": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"building_id"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"pinned"?: boolean,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"apartments": {
                  Row: {
                    "building_id": string,"created_at": string,"floor": number | null,"id": string,"notes": string | null,"number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"notes"?: string | null,"number": number
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"notes"?: string | null,"number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "apartments_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "key": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"value": string
                  }
                  Update: {
                    "key"?: string,"value"?: string
                  }
                  Relationships: [
                    
                  ]
                },"buildings": {
                  Row: {
                    "address": string | null,"billing_start": string | null,"created_at": string,"id": string,"name": string,"opening_cash": number,"opening_cash_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"billing_start"?: string | null,"created_at"?: string,"id"?: string,"name": string,"opening_cash"?: number,"opening_cash_date"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"billing_start"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"opening_cash"?: number,"opening_cash_date"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"maintenance_log": {
                  Row: {
                    "building_id": string,"cost": number | null,"created_at": string,"done_on": string,"expense_id": string | null,"id": string,"note": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"cost"?: number | null,"created_at"?: string,"done_on"?: string,"expense_id"?: string | null,"id"?: string,"note"?: string,"task_id": string
                  }
                  Update: {
                    "building_id"?: string,"cost"?: number | null,"created_at"?: string,"done_on"?: string,"expense_id"?: string | null,"id"?: string,"note"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_log_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_log_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "maintenance_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_tasks": {
                  Row: {
                    "building_id": string,"created_at": string,"frequency": string,"id": string,"next_due": string | null,"title": string,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"frequency": string,"id"?: string,"next_due"?: string | null,"title": string,"vendor"?: string
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"frequency"?: string,"id"?: string,"next_due"?: string | null,"title"?: string,"vendor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_tasks_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "building_id": string,"created_at": string,"email": string | null,"full_name": string,"is_super_admin": boolean,"resident_id": string | null,"role": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id": string,"created_at"?: string,"email"?: string | null,"full_name"?: string,"is_super_admin"?: boolean,"resident_id"?: string | null,"role"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"email"?: string | null,"full_name"?: string,"is_super_admin"?: boolean,"resident_id"?: string | null,"role"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_resident_id_fkey"
      columns: ["resident_id"]
isOneToOne: false
      referencedRelation: "residents"
      referencedColumns: ["id"]
    }
                  ]
                },"residents": {
                  Row: {
                    "apartment_id": string,"building_id": string,"created_at": string,"email": string | null,"full_name": string,"id": string,"is_owner": boolean,"phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "apartment_id": string,"building_id"?: string,"created_at"?: string,"email"?: string | null,"full_name": string,"id"?: string,"is_owner"?: boolean,"phone"?: string | null
                  }
                  Update: {
                    "apartment_id"?: string,"building_id"?: string,"created_at"?: string,"email"?: string | null,"full_name"?: string,"id"?: string,"is_owner"?: boolean,"phone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "residents_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "residents_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_comments": {
                  Row: {
                    "author_id": string | null,"body": string,"building_id": string,"created_at": string,"id": string,"ticket_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"building_id"?: string,"created_at"?: string,"id"?: string,"ticket_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"building_id"?: string,"created_at"?: string,"id"?: string,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_comments_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_comments_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"ticket_photos": {
                  Row: {
                    "building_id": string,"created_at": string,"id": string,"path": string,"ticket_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"id"?: string,"path": string,"ticket_id": string
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"id"?: string,"path"?: string,"ticket_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_photos_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ticket_photos_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"tickets": {
                  Row: {
                    "building_id": string,"created_at": string,"description": string,"id": string,"location": string,"opened_by": string | null,"status": string,"title": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"location"?: string,"opened_by"?: string | null,"status"?: string,"title": string,"vendor"?: string | null
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"location"?: string,"opened_by"?: string | null,"status"?: string,"title"?: string,"vendor"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "can_manage_ticket":
{ Args: { "p_ticket_id": string }; Returns: boolean
                           },
"default_building_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_approved":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_task_done":
{ Args: { "p_done_on": string,"p_note": string,"p_task_id": string }; Returns: string
                           },
"my_apartment_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"user_names":
{ Args: { "ids": (string)[] }; Returns: {
              "full_name": string,"user_id": string
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
