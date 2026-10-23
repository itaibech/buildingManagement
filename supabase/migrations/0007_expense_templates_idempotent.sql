-- 0007 recurring expenses are idempotent: an expense posted from a template remembers it, and a
-- template can post at most one expense per date (the UI always uses the first of the month).
-- The unique index is deliberately not partial: NULLs are distinct, so manual expenses (template_id
-- null) never conflict, and a plain index lets PostgREST's on_conflict=template_id,spent_on infer it
-- (ON CONFLICT can't infer a partial index unless the statement repeats its predicate).
alter table public.expenses
  add column template_id uuid null references public.expense_templates on delete set null;
create unique index expenses_template_id_spent_on_key on public.expenses (template_id, spent_on);
