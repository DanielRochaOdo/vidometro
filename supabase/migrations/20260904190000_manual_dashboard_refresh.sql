-- Permite que o botão "Atualizar painel" solicite uma coleta imediata sem expor
-- a chave privada da Edge Function ao navegador. A chamada pública passa por uma
-- função SECURITY DEFINER que recupera o segredo no Vault e aplica um pequeno
-- intervalo de proteção contra cliques repetidos.

create table if not exists private.vidometro_refresh_gate (
  id boolean primary key default true check (id),
  requested_at timestamptz not null default to_timestamp(0)
);

insert into private.vidometro_refresh_gate (id, requested_at)
values (true, to_timestamp(0))
on conflict (id) do nothing;

revoke all on table private.vidometro_refresh_gate from public, anon, authenticated;

create or replace function public.request_vidometro_refresh()
returns bigint
language plpgsql
security definer
set search_path = public, private, extensions, vault, pg_catalog
as $$
declare
  project_url text;
  secret_key text;
  request_id bigint;
  accepted_at timestamptz;
begin
  -- Evita disparos acidentais em sequência sem impedir uma atualização manual real.
  update private.vidometro_refresh_gate
     set requested_at = now()
   where id = true
     and requested_at <= now() - interval '15 seconds'
  returning requested_at into accepted_at;

  if accepted_at is null then
    return null;
  end if;

  select decrypted_secret
    into project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;

  select decrypted_secret
    into secret_key
    from vault.decrypted_secrets
   where name = 'collector_secret_key'
   limit 1;

  if project_url is null or secret_key is null then
    raise exception 'Vidometro: project_url ou collector_secret_key não configurado no Vault.';
  end if;

  select net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/collect-active-lives',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', secret_key
    ),
    body := jsonb_build_object(
      'source', 'dashboard-refresh',
      'force', true
    ),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_vidometro_refresh() from public;
grant execute on function public.request_vidometro_refresh() to anon, authenticated;
