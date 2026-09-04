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

## Coleta e histórico diário

A função `collect-active-lives` consulta a cada cinco minutos:

```text
GET https://{{Endpoint}}/v2/api/contratos/vidasAtivas?token={{token}}
```

A aplicação continua tendo leitura atualizada em intervalos de cinco minutos, mas o banco **não grava uma linha a cada consulta**. Existe somente **um registro por dia** em `active_lives_snapshots`.

Cada nova consulta do mesmo dia faz `upsert` sobre essa linha. Portanto, ao final do dia, o histórico preserva apenas a última leitura daquele dia:

- `totalVidasAtivas`
- `totalTitularesAtivos`
- `totalDependentesAtivos`
- `dataConsulta`
- horário da última coleta realizada naquele dia

A Edge Function também ignora chamadas repetidas dentro de aproximadamente cinco minutos para evitar chamadas excessivas à API Odontoart.

## 1. Criar o projeto Supabase

Crie um único projeto de produção no Supabase. Guarde:

- Project Ref
- Database password
- Project URL
- Publishable Key
- Secret Key

A Publishable Key pode ser utilizada pelo frontend porque a tabela está protegida por RLS e somente leitura pública é permitida. A Secret Key é exclusivamente service-to-service e nunca deve ir para o GitHub Pages.

## 2. Secrets da Edge Function

Autentique a Supabase CLI e configure apenas os segredos da API Odontoart:

```bash
supabase secrets set \
  VIDAS_ATIVAS_API_ENDPOINT="https://SEU_ENDPOINT" \
  VIDAS_ATIVAS_API_TOKEN="SEU_TOKEN" \
  VIDAS_ATIVAS_API_TIMEOUT_MS="15000" \
  --project-ref SEU_PROJECT_REF
```

O Supabase fornece automaticamente à Edge Function as chaves internas necessárias para acessar o banco. Nunca use prefixo `NEXT_PUBLIC_` nos dados da API Odontoart ou em uma Secret Key.

## 3. Bootstrap do Supabase Vault

Depois que a migration for aplicada, execute uma única vez no **SQL Editor** do Supabase:

```sql
select vault.create_secret(
  'https://SEU_PROJECT_REF.supabase.co',
  'project_url'
);

select vault.create_secret(
  'SUA_SECRET_KEY',
  'collector_secret_key'
);
```

Esses dois segredos permitem que o `pg_cron` chame a Edge Function sem expor o coletor ao navegador.

A migration cria o job `vidometro-collect-active-lives` com esta periodicidade:

```text
*/5 * * * *
```

Para conferir:

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

O workflow `.github/workflows/deploy-supabase.yml` usa esses valores para:

1. vincular o repositório ao projeto Supabase de produção;
2. executar `supabase db push`;
3. publicar as Edge Functions.

Isso acontece automaticamente quando alterações em `supabase/**` chegam à `main`.

## 5. GitHub Repository Variables

Em **Settings > Secrets and variables > Actions > Variables**, configure:

```text
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_PUBLISHABLE_KEY
```

Esses valores são incorporados ao frontend estático durante o build do GitHub Pages. A Publishable Key é pública por definição; o acesso real aos dados é controlado por RLS e grants no PostgreSQL.

## 6. GitHub Pages

Em **Settings > Pages**, selecione **GitHub Actions** como source.

Após merge na `main`, `.github/workflows/deploy-pages.yml`:

1. instala as dependências;
2. executa `next build` com `output: export`;
3. publica a pasta `out/` no GitHub Pages.

Para este repositório, o Next.js usa `/vidometro` como `basePath` durante o build no GitHub Actions.

## Banco e segurança

A migration em `supabase/migrations/` cria `public.active_lives_snapshots` com `collection_date` único. Isso garante fisicamente no banco que existe no máximo uma linha de histórico por dia.

A tabela tem RLS habilitado. O cliente público pode somente ler; insert/update/delete ficam reservados à Edge Function usando a credencial privilegiada do Supabase.

A RPC `vidometro_dashboard(p_from, p_to)` calcula no PostgreSQL:

- valor atual;
- primeiro e último dia do período;
- crescimento absoluto e percentual;
- série histórica diária;
- últimos cinco dias registrados.

O dia atual aparece no histórico com o valor mais recente disponível e vai sendo sobrescrito durante o dia. Depois que o dia termina, aquela linha deixa de ser alterada.

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

O fluxo é propositalmente simples:

```text
merge em main
   ├── GitHub Pages recebe o novo frontend
   └── Supabase recebe migrations/Edge Functions quando alteradas
```

Não há Vercel nem servidor de aplicação intermediário.
