
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
            "admin_audit": {
                  Row: {
                    "action": string,"actor": string | null,"apartment_id": string | null,"building_id": string,"created_at": string,"details": NonNullable<Json>,"id": string,"target_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"apartment_id"?: string | null,"building_id"?: string,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"apartment_id"?: string | null,"building_id"?: string,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"target_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_audit_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "admin_audit_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    }
                  ]
                },"announcement_reads": {
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
                    "author_id": string | null,"body": string,"building_id": string,"created_at": string,"expires_at": string | null,"id": string,"link": string | null,"pinned": boolean,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body"?: string,"building_id"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"link"?: string | null,"pinned"?: boolean,"title": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"building_id"?: string,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"link"?: string | null,"pinned"?: boolean,"title"?: string
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
                    "archived_at": string | null,"building_id": string,"created_at": string,"floor": number | null,"id": string,"is_committee": boolean,"notes": string | null,"number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"is_committee"?: boolean,"notes"?: string | null,"number": number
                  }
                  Update: {
                    "archived_at"?: string | null,"building_id"?: string,"created_at"?: string,"floor"?: number | null,"id"?: string,"is_committee"?: boolean,"notes"?: string | null,"number"?: number
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
                },"budget_defaults": {
                  Row: {
                    "amount": number,"building_id": string,"category_id": string,"created_at": string,"effective_from_year": number,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"category_id": string,"created_at"?: string,"effective_from_year": number,"id"?: string
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"category_id"?: string,"created_at"?: string,"effective_from_year"?: number,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "budget_defaults_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "budget_defaults_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "budget_defaults_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "expense_categories"
      referencedColumns: ["id"]
    }
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
                    "amount": number,"apartment_id": string,"building_id": string,"created_at": string,"ev_reading_id": string | null,"id": string,"is_special": boolean | null,"kind": string,"label": string,"month": string,"note": string,"settlement_id": string | null,"source": string,"special_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"apartment_id": string,"building_id"?: string,"created_at"?: string,"ev_reading_id"?: string | null,"id"?: string,"is_special"?: never,"kind": string,"label"?: string,"month": string,"note"?: string,"settlement_id"?: string | null,"source"?: string,"special_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"ev_reading_id"?: string | null,"id"?: string,"is_special"?: never,"kind"?: string,"label"?: string,"month"?: string,"note"?: string,"settlement_id"?: string | null,"source"?: string,"special_id"?: string | null
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
                },"email_log": {
                  Row: {
                    "apartment_ids": (string)[] | null,"building_id": string,"created_at": string,"dry_run": boolean,"error": string | null,"failed": number,"id": string,"kind": string,"recipients": number,"ref_id": string | null,"sent": number,"sent_by": string | null,"skipped": number,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "apartment_ids"?: (string)[] | null,"building_id": string,"created_at"?: string,"dry_run"?: boolean,"error"?: string | null,"failed"?: number,"id"?: string,"kind": string,"recipients"?: number,"ref_id"?: string | null,"sent"?: number,"sent_by"?: string | null,"skipped"?: number,"status"?: string
                  }
                  Update: {
                    "apartment_ids"?: (string)[] | null,"building_id"?: string,"created_at"?: string,"dry_run"?: boolean,"error"?: string | null,"failed"?: number,"id"?: string,"kind"?: string,"recipients"?: number,"ref_id"?: string | null,"sent"?: number,"sent_by"?: string | null,"skipped"?: number,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_log_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "email_log_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
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
                    "amount": number,"building_id": string,"category_id": string,"created_at": string,"id": string,"note": string,"receipt_name": string | null,"receipt_path": string | null,"source": string,"special_id": string | null,"spent_on": string,"template_id": string | null,"vendor": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"building_id"?: string,"category_id": string,"created_at"?: string,"id"?: string,"note"?: string,"receipt_name"?: string | null,"receipt_path"?: string | null,"source"?: string,"special_id"?: string | null,"spent_on"?: string,"template_id"?: string | null,"vendor"?: string
                  }
                  Update: {
                    "amount"?: number,"building_id"?: string,"category_id"?: string,"created_at"?: string,"id"?: string,"note"?: string,"receipt_name"?: string | null,"receipt_path"?: string | null,"source"?: string,"special_id"?: string | null,"spent_on"?: string,"template_id"?: string | null,"vendor"?: string
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
                },"group_permissions": {
                  Row: {
                    "group_id": string,"permission": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"permission": string
                  }
                  Update: {
                    "group_id"?: string,"permission"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_permissions_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "user_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_permissions_permission_fkey"
      columns: ["permission"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["key"]
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
                },"meeting_addenda": {
                  Row: {
                    "body": string,"created_at": string,"created_by": string | null,"id": string,"meeting_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"meeting_id": string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"meeting_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_addenda_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_agenda_items": {
                  Row: {
                    "added_during_meeting": boolean,"attendees_at_vote": number | null,"created_at": string,"decision": string,"decision_number": number | null,"discussion": string,"id": string,"item_status": string,"meeting_id": string,"position": number,"title": string,"updated_at": string,"votes_abstain": number | null,"votes_against": number | null,"votes_for": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "added_during_meeting"?: boolean,"attendees_at_vote"?: number | null,"created_at"?: string,"decision"?: string,"decision_number"?: number | null,"discussion"?: string,"id"?: string,"item_status"?: string,"meeting_id": string,"position"?: number,"title": string,"updated_at"?: string,"votes_abstain"?: number | null,"votes_against"?: number | null,"votes_for"?: number | null
                  }
                  Update: {
                    "added_during_meeting"?: boolean,"attendees_at_vote"?: number | null,"created_at"?: string,"decision"?: string,"decision_number"?: number | null,"discussion"?: string,"id"?: string,"item_status"?: string,"meeting_id"?: string,"position"?: number,"title"?: string,"updated_at"?: string,"votes_abstain"?: number | null,"votes_against"?: number | null,"votes_for"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_agenda_items_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_attendance": {
                  Row: {
                    "apartment_id": string | null,"apartment_number": number,"arrived_at": string | null,"attendee_name": string,"id": string,"left_at": string | null,"meeting_id": string,"proxy_file_path": string | null,"proxy_name": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "apartment_id"?: string | null,"apartment_number"?: number,"arrived_at"?: string | null,"attendee_name"?: string,"id"?: string,"left_at"?: string | null,"meeting_id": string,"proxy_file_path"?: string | null,"proxy_name"?: string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "apartment_id"?: string | null,"apartment_number"?: number,"arrived_at"?: string | null,"attendee_name"?: string,"id"?: string,"left_at"?: string | null,"meeting_id"?: string,"proxy_file_path"?: string | null,"proxy_name"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_attendance_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartment_balances"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "meeting_attendance_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "apartments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meeting_attendance_apartment_id_fkey"
      columns: ["apartment_id"]
isOneToOne: false
      referencedRelation: "monthly_fees"
      referencedColumns: ["apartment_id"]
    },{
      foreignKeyName: "meeting_attendance_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_documents": {
                  Row: {
                    "created_at": string,"created_by": string | null,"file_name": string,"file_path": string,"id": string,"meeting_id": string,"size_bytes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"file_name": string,"file_path": string,"id"?: string,"meeting_id": string,"size_bytes": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"file_name"?: string,"file_path"?: string,"id"?: string,"meeting_id"?: string,"size_bytes"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_documents_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_events": {
                  Row: {
                    "actor": string | null,"created_at": string,"details": NonNullable<Json>,"id": string,"kind": string,"meeting_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"kind": string,"meeting_id": string
                  }
                  Update: {
                    "actor"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"id"?: string,"kind"?: string,"meeting_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_events_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meeting_signatures": {
                  Row: {
                    "id": string,"image_path": string,"meeting_id": string,"method": string,"recorded_by": string | null,"role": string,"signed_at": string,"signer_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"image_path": string,"meeting_id": string,"method"?: string,"recorded_by"?: string | null,"role": string,"signed_at"?: string,"signer_name": string
                  }
                  Update: {
                    "id"?: string,"image_path"?: string,"meeting_id"?: string,"method"?: string,"recorded_by"?: string | null,"role"?: string,"signed_at"?: string,"signer_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meeting_signatures_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    }
                  ]
                },"meetings": {
                  Row: {
                    "building_id": string,"chair_name": string,"closed_at": string | null,"created_at": string,"created_by": string | null,"id": string,"invite_announcement_id": string | null,"invited_at": string | null,"kind": string,"location": string,"opened_at": string | null,"opened_without_quorum": boolean,"postponed_at": string | null,"postponed_to": string | null,"publish_announcement_id": string | null,"published_at": string | null,"quick_started": boolean,"quorum_mode": string,"quorum_note": string,"quorum_value": number | null,"scheduled_at": string,"secretary_name": string,"status": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"chair_name"?: string,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invite_announcement_id"?: string | null,"invited_at"?: string | null,"kind"?: string,"location"?: string,"opened_at"?: string | null,"opened_without_quorum"?: boolean,"postponed_at"?: string | null,"postponed_to"?: string | null,"publish_announcement_id"?: string | null,"published_at"?: string | null,"quick_started"?: boolean,"quorum_mode"?: string,"quorum_note"?: string,"quorum_value"?: number | null,"scheduled_at": string,"secretary_name"?: string,"status"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "building_id"?: string,"chair_name"?: string,"closed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"invite_announcement_id"?: string | null,"invited_at"?: string | null,"kind"?: string,"location"?: string,"opened_at"?: string | null,"opened_without_quorum"?: boolean,"postponed_at"?: string | null,"postponed_to"?: string | null,"publish_announcement_id"?: string | null,"published_at"?: string | null,"quick_started"?: boolean,"quorum_mode"?: string,"quorum_note"?: string,"quorum_value"?: number | null,"scheduled_at"?: string,"secretary_name"?: string,"status"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meetings_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "meetings_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "buildings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_invite_announcement_id_fkey"
      columns: ["invite_announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_publish_announcement_id_fkey"
      columns: ["publish_announcement_id"]
isOneToOne: false
      referencedRelation: "announcements"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"apartment_id": string,"building_id": string,"created_at": string,"for_month": string | null,"id": string,"is_special": boolean | null,"method": string,"note": string,"paid_on": string,"settlement_id": string | null,"source": string,"special_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"apartment_id": string,"building_id"?: string,"created_at"?: string,"for_month"?: string | null,"id"?: string,"is_special"?: never,"method": string,"note"?: string,"paid_on"?: string,"settlement_id"?: string | null,"source"?: string,"special_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"apartment_id"?: string,"building_id"?: string,"created_at"?: string,"for_month"?: string | null,"id"?: string,"is_special"?: never,"method"?: string,"note"?: string,"paid_on"?: string,"settlement_id"?: string | null,"source"?: string,"special_id"?: string | null
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
                },"permissions": {
                  Row: {
                    "description": string,"key": string,"label": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "description"?: string,"key": string,"label": string,"sort_order"?: number
                  }
                  Update: {
                    "description"?: string,"key"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "approved_at": string | null,"building_id": string,"created_at": string,"email": string | null,"full_name": string,"group_id": string | null,"is_super_admin": boolean,"resident_id": string | null,"role": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"building_id": string,"created_at"?: string,"email"?: string | null,"full_name"?: string,"group_id"?: string | null,"is_super_admin"?: boolean,"resident_id"?: string | null,"role"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "approved_at"?: string | null,"building_id"?: string,"created_at"?: string,"email"?: string | null,"full_name"?: string,"group_id"?: string | null,"is_super_admin"?: boolean,"resident_id"?: string | null,"role"?: string,"status"?: string,"user_id"?: string
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
      foreignKeyName: "profiles_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "user_groups"
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
                },"ticket_seen": {
                  Row: {
                    "seen_at": string,"ticket_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "seen_at"?: string,"ticket_id": string,"user_id": string
                  }
                  Update: {
                    "seen_at"?: string,"ticket_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ticket_seen_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"tickets": {
                  Row: {
                    "building_id": string,"created_at": string,"description": string,"id": string,"last_activity_by": string | null,"last_activity_kind": string,"location": string,"opened_by": string | null,"status": string,"title": string,"updated_at": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"last_activity_by"?: string | null,"last_activity_kind"?: string,"location"?: string,"opened_by"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"vendor"?: string | null
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"last_activity_by"?: string | null,"last_activity_kind"?: string,"location"?: string,"opened_by"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"vendor"?: string | null
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
                },"user_groups": {
                  Row: {
                    "building_id": string,"created_at": string,"description": string,"id": string,"is_default": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"is_default"?: boolean,"name": string
                  }
                  Update: {
                    "building_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"is_default"?: boolean,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_groups_building_id_fkey"
      columns: ["building_id"]
isOneToOne: false
      referencedRelation: "building_cash"
      referencedColumns: ["building_id"]
    },{
      foreignKeyName: "user_groups_building_id_fkey"
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
                    "adjusted": number | null,"apartment_id": string | null,"charged": number | null,"month": string | null,"paid": number | null
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
            "add_addendum":
{ Args: { "p_body": string,"p_meeting": string }; Returns: string
                           },
"add_special_charge":
{ Args: { "p_amount": number,"p_apartment_id": string,"p_category_id"?: string,"p_date_mode"?: string,"p_expense"?: boolean,"p_label": string,"p_method"?: string,"p_month": string,"p_note"?: string,"p_paid"?: boolean }; Returns: Json
                           },
"apartment_fee_at":
{ Args: { "p_apartment_id": string,"p_month": string }; Returns: {
              "amount": number,"fee_mode": string
            }[]
                           },
"apartment_history":
{ Args: { "p_id": string }; Returns: Json
                           },
"apartment_lock":
{ Args: { "p_id": string }; Returns: {
              "archived_at": string | null,
"building_id": string,
"created_at": string,
"floor": number | null,
"id": string,
"is_committee": boolean,
"notes": string | null,
"number": number
            }
                          SetofOptions: {
        from: "*"
        to: "apartments"
        isOneToOne: true
        isSetofReturn: false
      } },
"apply_standing_orders":
{ Args: { "p_apartment_id"?: string }; Returns: number
                           },
"archive_apartment":
{ Args: { "p_id": string }; Returns: undefined
                           },
"auth_user_by_email":
{ Args: { "p_email": string }; Returns: {
              "invited_at": string,"last_sign_in_at": string,"user_id": string
            }[]
                           },
"budget_for_year":
{ Args: { "p_year": number }; Returns: {
              "amount": number,"category": string,"category_id": string,"sort_order": number,"source": string
            }[]
                           },
"budget_summary":
{ Args: { "p_year": number }; Returns: {
              "actual_expenses": number,"actual_income": number,"expected_balance": number,"expected_income": number,"projected_expenses": number
            }[]
                           },
"building_cash_balance":
{ Args: { "p_building_id": string }; Returns: number
                           },
"building_expense_report":
{ Args: { "p_year": number }; Returns: {
              "category": string,"category_id": string,"month": string,"sort_order": number,"total": number
            }[]
                           },
"building_fee_at":
{ Args: { "p_building_id": string,"p_month": string }; Returns: number
                           },
"can_manage_ticket":
{ Args: { "p_ticket_id": string }; Returns: boolean
                           },
"can_read_apartment_ev":
{ Args: { "p_apartment_id": string }; Returns: boolean
                           },
"can_read_apartment_finance":
{ Args: { "p_apartment_id": string }; Returns: boolean
                           },
"cancel_postponement":
{ Args: { "p_meeting": string }; Returns: undefined
                           },
"close_meeting":
{ Args: { "p_closed_at"?: string,"p_meeting": string }; Returns: undefined
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
"delete_apartment_cascade":
{ Args: { "p_confirm_number": number,"p_id": string }; Returns: Json
                           },
"delete_ev_rate":
{ Args: { "p_id": string }; Returns: number
                           },
"delete_ev_reading":
{ Args: { "p_reading_id": string }; Returns: undefined
                           },
"email_sent_today":
{ Args: { "p_building": string }; Returns: number
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
"has_permission":
{ Args: { "p_key": string }; Returns: boolean
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
"invite_meeting":
{ Args: { "p_confirm_short_notice"?: boolean,"p_include_details"?: boolean,"p_meeting": string }; Returns: string
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_approved":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_meeting_file_path":
{ Args: { "p_meeting": string,"p_name": string }; Returns: boolean
                           },
"is_meeting_storage_path":
{ Args: { "p_name": string }; Returns: boolean
                           },
"is_receipt_path":
{ Args: { "p_name": string }; Returns: boolean
                           },
"mark_task_done":
{ Args: { "p_category_id"?: string,"p_cost"?: number,"p_done_on": string,"p_note": string,"p_task_id": string }; Returns: string
                           },
"mark_tickets_seen":
{ Args: { "p_ids"?: (string)[] }; Returns: undefined
                           },
"meeting_agenda_titles":
{ Args: { "p_meeting": string }; Returns: {
              "id": string,"item_position": number,"title": string
            }[]
                           },
"meeting_announce":
{ Args: { "m": Omit<Database["public"]['Tables']["meetings"]['Row'], Database["public"]['Tables']["meetings"]['ComputedFields']>,"p_body": string,"p_pinned": boolean,"p_title": string }; Returns: string
                           },
"meeting_do_open":
{ Args: { "m": Omit<Database["public"]['Tables']["meetings"]['Row'], Database["public"]['Tables']["meetings"]['ComputedFields']>,"p_chair": string,"p_opened_at": string,"p_override": boolean,"p_quick": boolean,"p_secretary": string }; Returns: undefined
                           },
"meeting_file_status":
{ Args: { "p_name": string }; Returns: string
                           },
"meeting_invitation_body":
{ Args: { "p_details"?: boolean,"p_meeting": string }; Returns: string
                           },
"meeting_kind_label":
{ Args: { "p_kind": string }; Returns: string
                           },
"meeting_local":
{ Args: { "p_at": string,"p_format": string }; Returns: string
                           },
"meeting_lock":
{ Args: { "p_meeting": string }; Returns: {
              "building_id": string,
"chair_name": string,
"closed_at": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"invite_announcement_id": string | null,
"invited_at": string | null,
"kind": string,
"location": string,
"opened_at": string | null,
"opened_without_quorum": boolean,
"postponed_at": string | null,
"postponed_to": string | null,
"publish_announcement_id": string | null,
"published_at": string | null,
"quick_started": boolean,
"quorum_mode": string,
"quorum_note": string,
"quorum_value": number | null,
"scheduled_at": string,
"secretary_name": string,
"status": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "meetings"
        isOneToOne: true
        isSetofReturn: false
      } },
"meeting_quorum":
{ Args: { "p_meeting": string }; Returns: {
              "attending": number,"met": boolean,"required": number,"total": number
            }[]
                           },
"meeting_require":
{ Args: { "p_ok": boolean,"p_reason": string }; Returns: undefined
                           },
"my_apartment_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"my_permissions":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_ticket_activity":
{ Args: Record<PropertyKey, never>; Returns: {
              "activity_at": string,"activity_by": string,"activity_kind": string,"apartment_number": number,"opened_by": string,"status": string,"ticket_id": string,"title": string,"unseen": boolean
            }[]
                           },
"open_meeting":
{ Args: { "p_chair"?: string,"p_meeting": string,"p_opened_at"?: string,"p_override_quorum"?: boolean,"p_secretary"?: string }; Returns: undefined
                           },
"postpone_meeting":
{ Args: { "p_meeting": string }; Returns: string
                           },
"publish_meeting":
{ Args: { "p_meeting": string }; Returns: string
                           },
"quick_start_meeting":
{ Args: { "p_chair": string,"p_meeting": string,"p_override_quorum"?: boolean,"p_secretary": string }; Returns: undefined
                           },
"record_ev_reading":
{ Args: { "p_charger_id": string,"p_month": string,"p_note"?: string,"p_read_on"?: string,"p_reading": number }; Returns: Json
                           },
"reserve_email_quota":
{ Args: { "p_apartment_ids"?: (string)[],"p_building": string,"p_cap": number,"p_count": number,"p_kind": string,"p_ref_id"?: string,"p_sent_by": string }; Returns: string
                           },
"restore_apartment":
{ Args: { "p_id": string }; Returns: undefined
                           },
"restore_fee_gap":
{ Args: { "p_apartment": string,"p_archived_at": string,"p_building": string }; Returns: undefined
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
"set_budgets":
{ Args: { "p_lines": Json,"p_scope": string,"p_year": number }; Returns: number
                           },
"set_default_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"settle_debt":
{ Args: { "p_apartment_id": string,"p_date_mode"?: string,"p_method"?: string,"p_mode": string,"p_months": (string)[],"p_note"?: string }; Returns: Json
                           },
"settlement_plan":
{ Args: { "p_apartment_id": string,"p_months": (string)[] }; Returns: {
              "amount": number,"month": string
            }[]
                           },
"sign_meeting":
{ Args: { "p_image_path": string,"p_meeting": string,"p_method"?: string,"p_role": string,"p_signer_name": string }; Returns: string
                           },
"standing_order_due":
{ Args: { "p_apartment_id": string }; Returns: {
              "amount": number,"apartment_id": string,"building_id": string,"month": string
            }[]
                           },
"undo_settlement":
{ Args: { "p_settlement_id": string }; Returns: Json
                           },
"undo_special_charge":
{ Args: { "p_special_id": string }; Returns: Json
                           },
"update_meeting_invitation":
{ Args: { "p_include_details"?: boolean,"p_meeting": string }; Returns: string
                           },
"user_names":
{ Args: { "ids": (string)[] }; Returns: {
              "full_name": string,"user_id": string
            }[]
                           },
"user_sign_in_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "invited_at": string,"last_sign_in_at": string,"user_id": string
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
