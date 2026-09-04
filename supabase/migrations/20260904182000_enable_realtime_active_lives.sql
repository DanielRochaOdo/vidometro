do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'active_lives_snapshots'
  ) then
    alter publication supabase_realtime
      add table public.active_lives_snapshots;
  end if;
end
$$;
