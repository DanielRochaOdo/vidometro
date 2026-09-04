import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { dbQuery, closeDb } from "../src/lib/db";

const dir = path.resolve(process.cwd(), "db", "migrations");

async function main() {
  await dbQuery(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(dir))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const version = Number(file.split("_", 1)[0]);
    const applied = await dbQuery<{ exists: boolean }>(
      "select exists(select 1 from schema_migrations where version = $1) as exists",
      [version]
    );
    if (applied.rows[0]?.exists) continue;

    // As migrations deste projeto são idempotentes. Se houver interrupção entre
    // o SQL e o registro da versão, a próxima execução pode reaplicá-las com segurança.
    const sql = await readFile(path.join(dir, file), "utf8");
    await dbQuery(sql);
    await dbQuery(
      `insert into schema_migrations(version, name) values ($1, $2)
       on conflict (version) do nothing`,
      [version, file]
    );
    console.info(`[migration] aplicada: ${file}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
