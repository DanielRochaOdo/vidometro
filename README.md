# Vidômetro

Dashboard operacional para acompanhamento de vidas ativas da Odontoart.

## Arquitetura

- Frontend estático em Next.js, publicado no GitHub Pages.
- Supabase para banco, RPCs, Realtime e Edge Function de coleta.
- `active_lives_snapshots`: histórico consolidado, com uma linha por dia e última leitura diária.
- `active_lives_realtime_samples`: janela operacional curta para o modo Realtime.
- Coleta automática via `pg_cron`, normalmente a cada 5 minutos.
- O botão **Atualizar painel** solicita uma coleta imediata pela função `request_vidometro_refresh()`, sem expor o segredo da Edge Function ao navegador.

## Dashboard

Filtros disponíveis:

- Realtime: amostras por ciclo de coleta e variação em relação ao ciclo anterior.
- 1 dia: leitura consolidada do dia atual.
- 7 dias.
- 30 dias.
- 90 dias.
- Período personalizado.

O filtro selecionado, datas personalizadas e tema ficam persistidos no navegador.

## Variáveis públicas do frontend

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Secrets da Edge Function

```env
VIDAS_ATIVAS_API_ENDPOINT=https://odontoart.s4e.com.br
VIDAS_ATIVAS_API_TOKEN=
VIDAS_ATIVAS_API_TIMEOUT_MS=15000
VIDOMETRO_COLLECTOR_SECRET=
```

O valor de `VIDOMETRO_COLLECTOR_SECRET` deve corresponder ao segredo `collector_secret_key` salvo no Vault do Supabase.

## Desenvolvimento

```bash
npm install
npm run dev
```

Validação:

```bash
npm run typecheck
npm run build
```
