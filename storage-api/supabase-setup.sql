-- ============================================================
-- Supabase setup — chạy 1 lần trong SQL Editor của Supabase
-- (bổ sung cho `prisma migrate deploy`, mục 8.C, 12.D)
-- ============================================================

-- 1) Extensions (nếu prisma chưa tạo) -----------------------
create extension if not exists vector;
create extension if not exists unaccent;
create extension if not exists pg_trgm;

-- 2) RPC AI Search — semantic search theo user (mục 8.C) -----
create or replace function match_document_chunks(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 10
)
returns table (
  file_id uuid,
  file_name text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    f.id as file_id,
    f.name as file_name,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from "DocumentChunk" dc
  join "File" f on f.id = dc."fileId"
  where f."userId" = match_user_id::text
    and f.status = 'ready'
    and f."deletedAt" is null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- 3) Realtime cho bảng Notification (mục 12.D, 12.J) ---------
-- Thêm vào publication + RLS policy lọc theo user nhận.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'Notification'
  ) then
    alter publication supabase_realtime add table "Notification";
  end if;
end $$;

alter table "Notification" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'Notification' and policyname = 'notif_select_own'
  ) then
    create policy notif_select_own on "Notification"
      for select to authenticated
      using ("userId" = auth.uid()::text);
  end if;
end $$;

-- 4) (Tuỳ chọn) Realtime cho bảng File để cập nhật thumbnail live (mục 7) ----
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'File'
  ) then
    alter publication supabase_realtime add table "File";
  end if;
end $$;

alter table "File" enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'File' and policyname = 'file_select_own'
  ) then
    create policy file_select_own on "File"
      for select to authenticated
      using ("userId" = auth.uid()::text);
  end if;
end $$;
