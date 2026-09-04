# Vidômetro

Dashboard independente para acompanhar as vidas ativas da Odontoart Online.

## O que o sistema mostra

- `totalVidasAtivas` em destaque;
- `totalTitularesAtivos`;
- `totalDependentesAtivos`;
- `dataConsulta`;
- atualização automática a cada 5 minutos enquanto o painel está aberto;
- histórico persistido em PostgreSQL;
- variação absoluta e percentual entre duas datas;
- gráfico de evolução das vidas ativas;
- gráfico de titulares x dependentes;
- tema claro/escuro persistido no navegador.

## API consultada

```text
GET https://{{Endpoint}}/v2/api/contratos/vidasAtivas?token={{token}}
```

O token nunca é enviado ao navegador. A consulta é feita exclusivamente no servidor Next.js.

## Requisitos

- Node.js 22+
- PostgreSQL 16+ recomendado

## Configuração

Copie `.env.example` para `.env.local`:

```env
VIDAS_ATIVAS_API_ENDPOINT=https://SEU_ENDPOINT
VIDAS_ATIVAS_API_TOKEN=SEU_TOKEN
VIDAS_ATIVAS_API_TIMEOUT_MS=15000
DATABASE_URL=postgresql://usuario:senha@localhost:5432/vidometro
DATABASE_SSL=false
CRON_SECRET=UM_SEGREDO_LONGO
```

`VIDAS_ATIVAS_API_ENDPOINT` pode ser somente a origem ou a URL completa terminando em `/v2/api/contratos/vidasAtivas`.

## Instalação

```bash
npm install
npm run db:migrate
npm run dev
```

Abra `http://localhost:3000`.

## Coleta de 5 em 5 minutos

O painel chama `POST /api/collect` automaticamente a cada 5 minutos. O backend deduplica coletas dentro da mesma janela de 5 minutos, evitando chamadas repetidas quando vários navegadores estão abertos.

Para manter a coleta **24 horas por dia mesmo sem ninguém com o painel aberto**, configure seu agendador/cron para chamar:

```text
GET https://SEU_DOMINIO/api/cron/collect
Authorization: Bearer SEU_CRON_SECRET
```

Cron recomendado:

```text
*/5 * * * *
```

## Cálculo de crescimento

Ao selecionar, por exemplo, `01/09/2026` até `30/09/2026`, o sistema pega o primeiro e o último snapshot existentes no intervalo:

```text
variação absoluta = último - primeiro
variação percentual = (último - primeiro) / primeiro * 100
```

O cálculo é exibido separadamente para vidas ativas, titulares e dependentes. Períodos de até 3 dias usam amostragem por hora nos gráficos; períodos maiores usam uma amostra por dia.

## Rotas internas

- `GET /api/dashboard?from=2026-09-01&to=2026-09-30`
- `POST /api/collect`
- `GET /api/cron/collect` (protegido por `CRON_SECRET`)

## Qualidade

```bash
npm run typecheck
npm run test
npm run build
```

O repositório inclui CI com PostgreSQL para validar migration, TypeScript, testes e build em cada pull request.
