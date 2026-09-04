# Vidômetro

Dashboard público para acompanhar as vidas ativas da Odontoart Online, com histórico e variação por período.

## Arquitetura

```text
GitHub
  ├── main
  └── GitHub Actions
       ├── frontend estático -> GitHub Pages
       └── migrations + Edge Functions -> Supabase

Supabase
  ├── PostgreSQL
  ├── Edge Function collect-active-lives
  └── histórico + RPC do dashboard
```

Não existe servidor Node em produção. O Next.js é exportado como site estático e o navegador acessa apenas a API pública do Supabase. O token da API Odontoart fica exclusivamente nos secrets da Edge Function.

## Coleta

A função `collect-active-lives` consulta:

```text
GET https://{{Endpoint}}/v2/api/contratos/vidasAtivas?token={{token}}
```

A coleta é deduplicada em janelas de cinco minutos e persiste:

- `totalVidasAtivas`
- `totalTitularesAtivos`
- `totalDependentesAtivos`
- `dataConsulta`
- horário em que o snapshot foi armazenado

O Supabase Cron chama a Edge Function a cada cinco minutos. O botão **Atualizar agora** também pode invocá-la, sem causar uma segunda coleta dentro da mesma janela.

## 1. Criar o projeto Supabase

Crie um projeto de produção no Supabase. Guarde:

- Project Ref
- Database password
- Project URL
- Publishable Key

## 2. Secrets da Edge Function

Autentique a Supabase CLI e configure os segredos da API Odontoart:

```bash
supabase secrets set \
  VIDAS_ATIVAS_API_ENDPOINT="https://SEU_ENDPOINT" \
  VIDAS_ATIVAS_API_TOKEN="SEU_TOKEN" \
  VIDAS_ATIVAS_API_TIMEOUT_MS="15000" \
  --project-ref SEU_PROJECT_REF
```

Nunca use prefixo `NEXT_PUBLIC_` nesses valores.

## 3. Bootstrap do Supabase Vault

Depois que a migration for aplicada, execute uma única vez no **SQL Editor** do Supabase:

```sql
select vault.create_secret(
  'https://SEU_PROJECT_REF.supabase.co',
  'project_url'
);

select vault.create_secret(
  'SUA_PUBLISHABLE_KEY',
  'publishable_key'
);
```

Esses valores permitem que o `pg_cron` invoque a Edge Function a cada cinco minutos. A migration cria o job `vidometro-collect-active-lives` automaticamente.

Para conferir o cron:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'vidometro-collect-active-lives';
```

## 4. GitHub Repository Secrets

Em **Settings > Secrets and variables > Actions > Secrets**, configure:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

O workflow `.github/workflows/deploy-supabase.yml` usa esses valores para aplicar migrations e publicar as Edge Functions quando houver alteração em `supabase/**` na `main`.

## 5. GitHub Repository Variables

Em **Settings > Secrets and variables > Actions > Variables**, configure:

```text
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_PUBLISHABLE_KEY
```

Esses dois valores são utilizados pelo frontend estático. A Publishable Key é uma credencial pública e o acesso aos dados é limitado por RLS e pelos grants definidos na migration.

## 6. GitHub Pages

Em **Settings > Pages**, selecione **GitHub Actions** como source.

Após merge na `main`, `.github/workflows/deploy-pages.yml`:

1. instala as dependências;
2. executa `next build` com `output: export`;
3. publica `out/` no GitHub Pages.

Para este repositório, o Next.js usa `/vidometro` como `basePath` durante o build no GitHub Actions.

## Banco e segurança

A migration em `supabase/migrations/` cria `public.active_lives_snapshots`, habilita RLS e concede ao cliente público somente leitura. Escrita e atualização são feitas pela Edge Function usando a Service Role disponibilizada pelo próprio ambiente do Supabase.

O frontend não consulta milhares de snapshots diretamente. A RPC `vidometro_dashboard(from, to)` calcula no PostgreSQL:

- snapshot atual;
- primeiro e último valor do período;
- crescimento absoluto e percentual;
- amostragem por hora para períodos curtos;
- amostragem diária para períodos maiores;
- últimas atualizações.

## Desenvolvimento local

Crie `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_PUBLISHABLE_KEY
```

Depois:

```bash
npm install
npm run dev
```

Validação local:

```bash
npm run typecheck
npm run build
```

## Produção

O fluxo de produção é propositalmente simples:

```text
merge em main
   ├── GitHub Pages recebe o novo frontend
   └── Supabase recebe migrations/Edge Functions quando alteradas
```

Não há Vercel nem servidor de aplicação intermediário.
