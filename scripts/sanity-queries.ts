/**
 * Manual sanity queries to demonstrate the DB works end-to-end.
 * Not part of CI; runnable via: npx tsx scripts/sanity-queries.ts
 */

import Database from '@ansvar/mcp-sqlite';
import { searchLegislation } from '../src/tools/search-legislation.js';
import { getProvision } from '../src/tools/get-provision.js';
import { getAbout } from '../src/tools/about.js';
import { listSources } from '../src/tools/list-sources.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env['DJ_LAW_DB_PATH'] ?? join(__dirname, '..', 'data', 'database.db');
const db = new Database(dbPath, { readonly: true });

async function main() {
  console.log('== about ==');
  const about = getAbout(db, { version: 'sanity', fingerprint: 'sanity', dbBuilt: 'sanity' });
  console.log('  server:', about.server);
  console.log('  jurisdiction:', about.data_source.jurisdiction);
  console.log('  source:', about.data_source.name);
  console.log('  statistics:', about.statistics);

  console.log('\n== list_sources ==');
  const sources = await listSources(db);
  console.log('  sources:', sources.results.sources.map(s => s.name));
  console.log('  db documents:', sources.results.database.document_count,
              'provisions:', sources.results.database.provision_count);

  for (const q of ['constitution', 'travail', 'protection des données', 'marchés publics', 'électrification']) {
    console.log(`\n== search_legislation: "${q}" ==`);
    const r = await searchLegislation(db, { query: q, limit: 3 });
    console.log('  hits:', r.results.length);
    for (const hit of r.results.slice(0, 2)) {
      console.log(`   - ${hit.document_title.slice(0, 80)}`);
      console.log(`     ${hit.provision_ref}: ${hit.snippet.slice(0, 140)}`);
    }
  }

  console.log('\n== get_provision: Constitution revision, art1 ==');
  const prov = await getProvision(db, {
    document_id: 'loi-n192-an-25-9eme-l-portant-revision-de-la-constitution',
    section: '1',
  });
  console.log('  hits:', prov.results.length);
  if (prov.results[0]) {
    console.log('  content[:300]:', prov.results[0].content.slice(0, 300));
  }

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
