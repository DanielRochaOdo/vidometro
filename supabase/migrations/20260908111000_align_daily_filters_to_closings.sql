-- Os filtros de 7, 30 e 90 dias passam a usar os últimos N fechamentos
-- efetivamente registrados, e não apenas uma janela de N dias corridos.
-- Cada linha de active_lives_snapshots representa a última leitura do dia.
create or replace function public.vidometro_dashboard(
  p_from date default (current_date - 29),
  p_to date default current_date
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      greatest(1, (p_to - p_from) + 1) as requested_count,
      (now() at time zone 'America/Fortaleza')::date as today,
      p_to = (now() at time zone 'America/Fortaleza')::date
        and greatest(1, (p_to - p_from) + 1) in (7, 30, 90) as use_last_n_closings
  ),
  last_n_rows as (
    select s.*
    from public.active_lives_snapshots s
    order by s.collection_date desc, s.collected_at desc, s.id desc
    limit (select requested_count from params)
  ),
  period_rows as (
    select s.*
    from last_n_rows s
    cross join params p
    where p.use_last_n_closings

    union all

    select s.*
    from public.active_lives_snapshots s
    cross join params p
    where not p.use_last_n_closings
      and s.collection_date between p_from and p_to
  ),
  first_row as (
    select *
    from period_rows
    order by collection_date asc, collected_at asc, id asc
    limit 1
  ),
  last_row as (
    select *
    from period_rows
    order by collection_date desc, collected_at desc, id desc
    limit 1
  ),
  latest_row as (
    select *
    from public.active_lives_snapshots
    order by collected_at desc, id desc
    limit 1
  ),
  recent_rows as (
    select *
    from public.active_lives_snapshots
    order by collection_date desc, collected_at desc, id desc
    limit 5
  )
  select jsonb_build_object(
    'sampling', 'day',
    'latest', (
      select jsonb_build_object(
        'totalVidasAtivas', total_active_lives,
        'totalTitularesAtivos', total_active_holders,
        'totalDependentesAtivos', total_active_dependents,
        'dataConsulta', consulted_at,
        'collectedAt', collected_at
      ) from latest_row
    ),
    'first', (
      select jsonb_build_object(
        'totalVidasAtivas', total_active_lives,
        'totalTitularesAtivos', total_active_holders,
        'totalDependentesAtivos', total_active_dependents,
        'dataConsulta', consulted_at,
        'collectedAt', collected_at
      ) from first_row
    ),
    'last', (
      select jsonb_build_object(
        'totalVidasAtivas', total_active_lives,
        'totalTitularesAtivos', total_active_holders,
        'totalDependentesAtivos', total_active_dependents,
        'dataConsulta', consulted_at,
        'collectedAt', collected_at
      ) from last_row
    ),
    'growth', (
      select jsonb_build_object(
        'totalVidasAtivas', jsonb_build_object(
          'absolute', l.total_active_lives - f.total_active_lives,
          'percentage', case
            when f.total_active_lives = 0 then null
            else round(((l.total_active_lives - f.total_active_lives) * 100.0 / f.total_active_lives)::numeric, 3)
          end
        ),
        'totalTitularesAtivos', jsonb_build_object(
          'absolute', l.total_active_holders - f.total_active_holders,
          'percentage', case
            when f.total_active_holders = 0 then null
            else round(((l.total_active_holders - f.total_active_holders) * 100.0 / f.total_active_holders)::numeric, 3)
          end
        ),
        'totalDependentesAtivos', jsonb_build_object(
          'absolute', l.total_active_dependents - f.total_active_dependents,
          'percentage', case
            when f.total_active_dependents = 0 then null
            else round(((l.total_active_dependents - f.total_active_dependents) * 100.0 / f.total_active_dependents)::numeric, 3)
          end
        )
      )
      from first_row f
      cross join last_row l
    ),
    'trend', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'totalVidasAtivas', total_active_lives,
          'totalTitularesAtivos', total_active_holders,
          'totalDependentesAtivos', total_active_dependents,
          'dataConsulta', consulted_at,
          'collectedAt', collected_at
        ) order by collection_date, collected_at, id
      )
      from period_rows
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'totalVidasAtivas', total_active_lives,
          'totalTitularesAtivos', total_active_holders,
          'totalDependentesAtivos', total_active_dependents,
          'dataConsulta', consulted_at,
          'collectedAt', collected_at
        ) order by collection_date desc, collected_at desc, id desc
      )
      from recent_rows
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.vidometro_dashboard(date, date) from public;
grant execute on function public.vidometro_dashboard(date, date) to anon, authenticated;
