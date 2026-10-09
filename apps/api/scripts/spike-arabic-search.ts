/**
 * Stage 0 spike: PostgreSQL search behaviour for Arabic + English content (run once; results are recorded in
 * docs/DEALDASH_TECH_SPIKES.md). Uses a TEMP table in the test database; nothing persists.
 *   pnpm --filter @dealdash/api exec tsx scripts/spike-arabic-search.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { normalizeArabic } from '@dealdash/localization';

const env = resolve(__dirname, '../../../.env');
if (existsSync(env)) process.loadEnvFile(env);

async function main() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  const out: Record<string, unknown> = {};
  try {
    out.version = (await c.query('SHOW server_version')).rows[0].server_version;
    out.tsConfigs = (
      await c.query(
        "SELECT cfgname FROM pg_ts_config WHERE cfgname IN ('arabic','english','simple') ORDER BY 1",
      )
    ).rows.map((r) => r.cfgname);
    for (const ext of ['pg_trgm', 'unaccent']) {
      try {
        await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
        out[ext] = 'available';
      } catch (e) {
        out[ext] = `NOT available: ${(e as Error).message}`;
      }
    }

    await c.query('CREATE TEMP TABLE m (id serial, name_en text, name_ar text, name_norm text)');
    const rows: Array<[string, string]> = [
      ['Nobu Riyadh', 'مطعم نوبو الرياض'],
      ['Harbour Grill', 'هاربور جريل'],
      ['Daily Dose Juice', 'ديلي دوز جوس'],
      ['Ahmed Cafe', 'مقهى أحمد'],
      ['Al Baik', 'البيك'],
    ];
    for (const [en, ar] of rows)
      await c.query('INSERT INTO m(name_en, name_ar, name_norm) VALUES ($1,$2,$3)', [
        en,
        ar,
        normalizeArabic(ar),
      ]);

    const q = async (label: string, sql: string, params: unknown[]) => {
      const r = await c.query(sql, params);
      out[label] = r.rows.map((x) => x.name_en);
    };

    // 1) Arabic full-text with the built-in 'arabic' configuration (stemming).
    await q(
      'fts_arabic_exact',
      "SELECT name_en FROM m WHERE to_tsvector('arabic', name_ar) @@ plainto_tsquery('arabic', $1)",
      ['نوبو'],
    );
    // 2) hamza variants: query without hamza vs text with hamza, with and without app-side normalisation.
    await q(
      'fts_hamza_raw',
      "SELECT name_en FROM m WHERE to_tsvector('arabic', name_ar) @@ plainto_tsquery('arabic', $1)",
      ['احمد'],
    );
    await q(
      'fts_hamza_normalised',
      "SELECT name_en FROM m WHERE to_tsvector('simple', name_norm) @@ plainto_tsquery('simple', $1)",
      [normalizeArabic('احمد')],
    );
    // 3) trigram similarity for typos / partial words (language independent).
    if (out.pg_trgm === 'available') {
      await q(
        'trgm_typo_en',
        'SELECT name_en FROM m WHERE name_en % $1 ORDER BY similarity(name_en, $1) DESC',
        ['Harbor Grill'],
      );
      await q('trgm_partial_ar', 'SELECT name_en FROM m WHERE name_norm ILIKE $1', [
        `%${normalizeArabic('نوب')}%`,
      ]);
    }
    // 4) mixed-script input matches either column.
    await q('mixed_script', 'SELECT name_en FROM m WHERE name_en ILIKE $1 OR name_norm ILIKE $2', [
      '%nobu%',
      `%${normalizeArabic('نوبو')}%`,
    ]);
    // 5) Arabic-Indic digits are not equal to Western digits in text search: policy is Western digits only.
    out.digitPolicy =
      'Western digits are stored and shown; normalise Arabic-Indic digits on input.';
  } finally {
    await c.end();
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
