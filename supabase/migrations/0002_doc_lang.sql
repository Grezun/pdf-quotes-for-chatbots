alter table public.settings add column if not exists doc_lang text not null default 'auto' check (doc_lang in ('auto', 'en', 'he'));
