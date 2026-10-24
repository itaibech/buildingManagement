
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "announcements_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"apartment_billing": {
                  Row: {
                    "apartment_id": string,"building_id": string,"created_at": string,"payment_method": string,"standing_order_from": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "apartment_id": string,"building_id"?: string,"created_at"?: string,"payment_method"?: string,"standing_order_from"?: string | null
                  }
                  Update: {
                    "apartment_id"?: string,"building_id"?: string,"created_at"?: string,"payment_method"?: string,"standing_order_from"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "apartment_billing_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "apartment_billing_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "apartment_billing_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "apartment_billing_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "apartment_billing_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"apartment_fee_overrides": {
                  Row: {
                    "amount": number | null,"apartment_id": string,"building_id": string,"created_at": string,"effective_from": string,"id": string,"mode": string,"restore_amount": number | null,"restore_mode": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"apartment_id": string,"building_id"?: string,"created_at"?: string,"effective_from": string,"id"?: string,"mode"?: string,"restore_amount"?: number | null,"restore_mode"?: string | null,"source"?: string
                  }
                  Update: {
                    "amount"?: number | null,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"effective_from"?: string,"id"?: string,"mode"?: string,"restore_amount"?: number | null,"restore_mode"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "apartment_fee_overrides_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "apartment_fee_overrides_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "apartment_fee_overrides_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "apartment_fee_overrides_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "apartment_fee_overrides_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"apartments": {
                  Row: {
                    "building_id": string,"created_at": string,"floor": number | null,"id": string,"is_committee": boolean,"notes": string | null,"number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"is_committee"?: boolean,"notes"?: string | null,"number": number
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"is_committee"?: boolean,"notes"?: string | null,"number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "apartments_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
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
                },"budgets": {
                  Row: {
                    "amount": number,"building_id": string,"category_id": string,"created_at": string,"id": string,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"category_id": string,"created_at"?: string,"id"?: string,"year": number
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"category_id"?: string,"created_at"?: string,"id"?: string,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "budgets_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "budgets_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budgets_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"buildings": {
                  Row: {
                    "address": string | null,"billing_start": string | null,"committee_contact": string | null,"created_at": string,"id": string,"name": string,"opening_cash": number,"opening_cash_date": string | null,"payment_instructions": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: string | null,"billing_start"?: string | null,"committee_contact"?: string | null,"created_at"?: string,"id"?: string,"name": string,"opening_cash"?: number,"opening_cash_date"?: string | null,"payment_instructions"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"billing_start"?: string | null,"committee_contact"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"opening_cash"?: number,"opening_cash_date"?: string | null,"payment_instructions"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"charges": {
                  Row: {
                    "amount": number,"apartment_id": string,"building_id": string,"created_at": string,"ev_reading_id": string | null,"id": string,"kind": string,"label": string,"month": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"apartment_id": string,"building_id"?: string,"created_at"?: string,"ev_reading_id"?: string | null,"id"?: string,"kind": string,"label"?: string,"month": string,"source"?: string
                  }
                  Update: {
                    "amount"?: number,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"ev_reading_id"?: string | null,"id"?: string,"kind"?: string,"label"?: string,"month"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "charges_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "charges_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "charges_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "charges_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "charges_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "charges_ev_reading_id_fkey"
      columns: ["ev_reading_id"]
isOneToOne: false
      referencedRelation: "ev_readings"
      referencedColumns: ["id"]
    }
                  ]
                },"ev_chargers": {
                  Row: {
                    "active": boolean,"apartment_id": string,"building_id": string,"created_at": string,"id": string,"initial_reading": number,"label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"apartment_id": string,"building_id"?: string,"created_at"?: string,"id"?: string,"initial_reading"?: number,"label"?: string
                  }
                  Update: {
                    "active"?: boolean,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"id"?: string,"initial_reading"?: number,"label"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ev_chargers_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "ev_chargers_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ev_chargers_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: true
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "ev_chargers_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "ev_chargers_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"ev_rates": {
                  Row: {
                    "building_id": string,"created_at": string,"effective_from": string,"id": string,"rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"effective_from": string,"id"?: string,"rate": number
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"effective_from"?: string,"id"?: string,"rate"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ev_rates_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "ev_rates_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"ev_readings": {
                  Row: {
                    "amount": number | null,"building_id": string,"charger_id": string,"created_at": string,"id": string,"kwh": number | null,"month": string,"note": string,"rate": number | null,"read_on": string | null,"reading": number,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"building_id"?: string,"charger_id": string,"created_at"?: string,"id"?: string,"kwh"?: number | null,"month": string,"note"?: string,"rate"?: number | null,"read_on"?: string | null,"reading": number,"source"?: string
                  }
                  Update: {
                    "amount"?: number | null,"building_id"?: string,"charger_id"?: string,"created_at"?: string,"id"?: string,"kwh"?: number | null,"month"?: string,"note"?: string,"rate"?: number | null,"read_on"?: string | null,"reading"?: number,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ev_readings_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "ev_readings_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ev_readings_charger_id_fkey"
      columns: ["charger_id"]
isOneToOne: false
      referencedRelation: "ev_chargers"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_categories": {
                  Row: {
                    "building_id": string,"created_at": string,"id": string,"name": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"id"?: string,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"id"?: string,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_categories_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "expense_categories_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"expense_templates": {
                  Row: {
                    "amount": number,"building_id": string,"category_id": string,"created_at": string,"id": string,"label": string,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"category_id": string,"created_at"?: string,"id"?: string,"label": string,"vendor"?: string
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"category_id"?: string,"created_at"?: string,"id"?: string,"label"?: string,"vendor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expense_templates_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "expense_templates_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expense_templates_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    }
                  ]
                },"expenses": {
                  Row: {
                    "amount": number,"building_id": string,"category_id": string,"created_at": string,"id": string,"note": string,"receipt_path": string | null,"source": string,"spent_on": string,"template_id": string | null,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"category_id": string,"created_at"?: string,"id"?: string,"note"?: string,"receipt_path"?: string | null,"source"?: string,"spent_on"?: string,"template_id"?: string | null,"vendor"?: string
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"category_id"?: string,"created_at"?: string,"id"?: string,"note"?: string,"receipt_path"?: string | null,"source"?: string,"spent_on"?: string,"template_id"?: string | null,"vendor"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "expenses_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "expenses_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expenses_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "expense_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"fee_schedule": {
                  Row: {
                    "amount": number,"building_id": string,"created_at": string,"effective_from": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"created_at"?: string,"effective_from": string,"id"?: string
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"created_at"?: string,"effective_from"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fee_schedule_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "fee_schedule_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "maintenance_log_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_log_expense_id_fkey"
      columns: ["expense_id"]
isOneToOne: false
      referencedRelation: "expenses"
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "maintenance_tasks_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"apartment_id": string,"building_id": string,"created_at": string,"id": string,"method": string,"note": string,"paid_on": string,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"apartment_id": string,"building_id"?: string,"created_at"?: string,"id"?: string,"method": string,"note"?: string,"paid_on"?: string,"source"?: string
                  }
                  Update: {
                    "amount"?: number,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"id"?: string,"method"?: string,"note"?: string,"paid_on"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "payments_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "payments_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "payments_building_id_fkey"
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
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
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "residents_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "residents_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "residents_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
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
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
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
            "apartment_balances": {
                  Row: {
                    "apartment_id": string,"balance": number | null,"charged": number | null,"current_fee": number | null,"current_fee_mode": string | null,"paid": number | null,"scheduled_charges": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"apartment_ledger": {
                  Row: {
                    "apartment_id": string | null,"charged": number | null,"month": string | null,"paid": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"building_cash": {
                  Row: {
                    "balance": number | null,"building_id": string
                  }
                  ComputedFields: never
                  Insert: {
                           "balance"?: never,"building_id"?: string | null
                         }
                        Update: {
                           "balance"?: never,"building_id"?: string | null
                         }
                        Relationships: [
                    
                  ]
                },"monthly_fees": {
                  Row: {
                    "amount": number | null,"apartment_id": string,"fee_mode": string | null,"month": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "apartment_fee_at":
{ Args: { "p_apartment_id": string,"p_month": string }; Returns: {
              "amount": number,"fee_mode": string
            }[]
                           },
"apply_standing_orders":
{ Args: { "p_apartment_id"?: string }; Returns: number
                           },
"building_cash_balance":
{ Args: { "p_building_id": string }; Returns: number
                           },
"building_fee_at":
{ Args: { "p_building_id": string,"p_month": string }; Returns: number
                           },
"can_manage_ticket":
{ Args: { "p_ticket_id": string }; Returns: boolean
                           },
"can_read_apartment_finance":
{ Args: { "p_apartment_id": string }; Returns: boolean
                           },
"collection_summary":
{ Args: { "p_month": string }; Returns: {
              "amount_due_total": number,"apartments_paid_up": number,"apartments_total": number
            }[]
                           },
"current_month":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"default_building_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"delete_ev_rate":
{ Args: { "p_id": string }; Returns: number
                           },
"delete_ev_reading":
{ Args: { "p_reading_id": string }; Returns: undefined
                           },
"ev_charge_reading":
{ Args: { "p_reading_id": string }; Returns: Json
                           },
"ev_covered":
{ Args: { "p": Json }; Returns: {
              "month": string,"number": number
            }[]
                           },
"ev_import_charger":
{ Args: { "b": string,"c": Json }; Returns: Json
                           },
"ev_import_payments":
{ Args: { "b": string,"p": Json }; Returns: number
                           },
"ev_import_rates":
{ Args: { "b": string,"p": Json }; Returns: undefined
                           },
"ev_is_month":
{ Args: { "j": Json }; Returns: boolean
                           },
"ev_is_number":
{ Args: { "hi": number,"j": Json,"lo": number }; Returns: boolean
                           },
"ev_lock_all":
{ Args: { "b": string }; Returns: undefined
                           },
"ev_recompute_from":
{ Args: { "b": string,"p_from": string }; Returns: number
                           },
"ev_recompute_next":
{ Args: { "p_charger_id": string,"p_month": string }; Returns: undefined
                           },
"ev_replace_main":
{ Args: { "b": string,"p": Json }; Returns: Json
                           },
"ev_validate":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_check":
{ Args: { "ok": boolean,"what": string }; Returns: undefined
                           },
"import_ev":
{ Args: { "payload": Json }; Returns: Json
                           },
"import_ev_paid":
{ Args: { "p_apartment": string,"p_note": string,"p_paid_on": string }; Returns: boolean
                           },
"import_exempt":
{ Args: { "b": string,"p": Json,"y0": string }; Returns: Json
                           },
"import_fees":
{ Args: { "b": string,"p": Json,"y0": string,"y1": string }; Returns: Json
                           },
"import_is_amount":
{ Args: { "j": Json }; Returns: boolean
                           },
"import_is_ev_charge":
{ Args: { "p_apartment": string,"p_kind": string,"p_label": string }; Returns: boolean
                           },
"import_is_int":
{ Args: { "hi": number,"j": Json,"lo": number }; Returns: boolean
                           },
"import_is_month":
{ Args: { "j": Json,"y": number }; Returns: boolean
                           },
"import_is_text":
{ Args: { "hi": number,"j": Json,"lo": number }; Returns: boolean
                           },
"import_money":
{ Args: { "b": string,"p": Json }; Returns: Json
                           },
"import_people":
{ Args: { "b": string,"p": Json }; Returns: Json
                           },
"import_replaced_kinds":
{ Args: { "p": Json }; Returns: (string)[]
                           },
"import_spending":
{ Args: { "b": string,"p": Json }; Returns: Json
                           },
"import_validate_exempt":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_validate_keep":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_validate_refs":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_validate_rows":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_validate_shape":
{ Args: { "p": Json }; Returns: undefined
                           },
"import_year":
{ Args: { "payload": Json }; Returns: Json
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_approved":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"mark_task_done":
{ Args: { "p_category_id"?: string,"p_cost"?: number,"p_done_on": string,"p_note": string,"p_task_id": string }; Returns: string
                           },
"my_apartment_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"record_ev_reading":
{ Args: { "p_charger_id": string,"p_month": string,"p_note"?: string,"p_read_on"?: string,"p_reading": number }; Returns: Json
                           },
"save_apartment":
{ Args: { "p_ev"?: boolean,"p_ev_initial"?: number,"p_fee"?: number,"p_floor"?: number,"p_id"?: string,"p_is_committee"?: boolean,"p_notes"?: string,"p_number"?: number,"p_payment_method"?: string,"p_standing_order_from"?: string }; Returns: string
                           },
"save_apartment_fee":
{ Args: { "p_committee": boolean,"p_fee": number,"p_id": string,"p_month": string,"p_was_committee": boolean }; Returns: boolean
                           },
"save_apartment_validate":
{ Args: { "p_ev_initial": number,"p_fee": number,"p_number": number,"p_payment_method": string,"p_standing_order_from": string }; Returns: undefined
                           },
"save_ev_rate":
{ Args: { "p_effective_from": string,"p_rate": number }; Returns: number
                           },
"set_apartment_fee":
{ Args: { "p_amount"?: number,"p_apartment_id": string,"p_effective_from": string,"p_mode": string }; Returns: boolean
                           },
"standing_order_due":
{ Args: { "p_apartment_id": string }; Returns: {
              "amount": number,"apartment_id": string,"building_id": string,"month": string
            }[]
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
