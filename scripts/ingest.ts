#!/usr/bin/env tsx
/**
 * Djibouti Law MCP — Census-Driven Ingestion Pipeline
 *
 * Reads data/census.json and fetches every ingestable texte-juridique from the
 * JORD WordPress REST API. Output is one seed JSON per act in data/seed/.
 *
 * Pipeline per act:
 *   1. GET /wp/v2/texte-juridique/{wp_id}?_embed (full record with content HTML)
 *   2. Normalise HTML → plain text (French, UTF-8)
 *   3. Parse TITRE/CHAPITRE/SECTION/Article structure into provisions
 *   4. Write data/seed/{id}.json for the database builder
 *
 * Features:
 *   - Resume: skips acts whose seed JSON already exists (unless --force)
 *   - Rate-limited (500ms minimum between HTTP requests)
 *   - Progress persisted: writes census.json updates every 25 acts
 *
 * Usage:
 *   npm run ingest                     # full census-driven ingestion
 *   npm run ingest -- --limit 20       # test run of 20 acts
 *   npm run ingest -- --force          # re-ingest even if seed exists
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchJson } from './lib/fetcher.js';
import {
  htmlToText,
  parseProvisions,
  buildShortName,
  toIsoDate,
  parseAcfDate,
  type ParsedAct,
  type ParsedProvision,
} from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = 'https://www.journalofficiel.dj/wp-json/wp/v2';
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');

interface CensusLaw {
  id: string;
  wp_id: number;
  title: string;
  identifier: string;
  url: string;
  nature: string;
  nature_slug: string;
  institution_ids: number[];
  issued_date: string;
  status: 'in_force' | 'amended' | 'repealed';
  classification: 'ingestable' | 'excluded' | 'inaccessible';
  ingested: boolean;
  provision_count: number;
  ingestion_date: string | null;
  journal_officiel_ids: number[];
}

interface CensusFile {
  schema_version: string;
  jurisdiction: string;
  jurisdiction_name: string;
  portal: string;
  census_date: string;
  agent: string;
  natures_covered: { slug: string; name: string; count: number }[];
  summary: {
    total_laws: number;
    ingestable: number;
    excluded: number;
    inaccessible: number;
    ingested: number;
  };
  laws: CensusLaw[];
}

interface WpTexteFull {
  id: number;
  date: string;
  modified: string;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string; protected?: boolean };
  'nature-dun-texte'?: number[];
  institution?: number[];
  acf?: {
    reference?: string;
    date?: string;
    comment?: string;
    visas?: string;
    signature?: string;
    journal_officiel?: number[];
  };
  _embedded?: {
    'wp:term'?: Array<Array<{ id: number; slug: string; name: string; taxonomy: string }>>;
  };
}

interface CliArgs {
  limit: number | null;
  force: boolean;
  filter: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let force = false;
  let filter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i] === '--filter' && args[i + 1]) {
      filter = args[i + 1]!;
      i++;
    }
  }
  return { limit, force, filter };
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&rsquo;/g, '’')
    .replace(/&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function taxonomyName(embedded: WpTexteFull['_embedded'], taxonomy: string): string | undefined {
  const terms = embedded?.['wp:term'];
  if (!terms) return undefined;
  for (const group of terms) {
    for (const term of group) {
      if (term.taxonomy === taxonomy) return term.name;
    }
  }
  return undefined;
}

async function fetchTexte(wpId: number): Promise<WpTexteFull> {
  const { data } = await fetchJson<WpTexteFull>(`${BASE}/texte-juridique/${wpId}?_embed=1`);
  return data;
}

function buildAct(law: CensusLaw, wp: WpTexteFull): { act: ParsedAct; provisions: ParsedProvision[] } {
  const title = cleanTitle(wp.title.rendered) || law.title;
  const visas = wp.acf?.visas?.trim();
  const signature = wp.acf?.signature?.trim();
  const description = wp.acf?.comment ? htmlToText(wp.acf.comment) : undefined;

  const bodyText = htmlToText(wp.content?.rendered ?? '');
  let provisions = parseProvisions(bodyText);

  // If no Article markers were found, fall back to a single "body" provision
  // so the act is still searchable in FTS. This happens for short decisions
  // that use a narrative DÉCIDE block rather than numbered articles.
  if (provisions.length === 0 && bodyText) {
    provisions = [
      {
        provision_ref: 'body',
        section: 'body',
        title: 'Corps du texte',
        content: bodyText,
      },
    ];
  }

  // Prepend a synthetic "visas" provision if we have it — it's legally meaningful
  // (gives the legal bases the act rests on).
  if (visas) {
    provisions.unshift({
      provision_ref: 'visas',
      section: 'visas',
      title: 'Visas',
      content: visas,
    });
  }

  if (signature) {
    provisions.push({
      provision_ref: 'signature',
      section: 'signature',
      title: 'Signature',
      content: signature,
    });
  }

  const institution = taxonomyName(wp._embedded, 'institution');
  const nature = taxonomyName(wp._embedded, 'nature-dun-texte') ?? law.nature;

  const issued = parseAcfDate(wp.acf?.date) || toIsoDate(wp.date) || law.issued_date;

  const act: ParsedAct = {
    id: law.id,
    type: 'statute',
    title,
    short_name: buildShortName(title, 80),
    status: law.status,
    reference: wp.acf?.reference?.trim() || law.identifier,
    issued_date: issued,
    url: wp.link || law.url,
    description,
    nature,
    institution,
    visas,
    signature,
    journal_issue_ids: wp.acf?.journal_officiel ?? law.journal_officiel_ids,
    provisions,
  };

  return { act, provisions };
}

function writeSeed(act: ParsedAct): void {
  const outPath = path.join(SEED_DIR, `${act.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(act, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  const { limit, force, filter } = parseArgs();

  console.log('Djibouti Law MCP -- Ingestion Pipeline (JORD WP REST API)');
  console.log('=========================================================');
  if (limit !== null) console.log(`  --limit ${limit}`);
  if (force) console.log(`  --force`);
  if (filter) console.log(`  --filter ${filter}`);

  if (!fs.existsSync(SEED_DIR)) fs.mkdirSync(SEED_DIR, { recursive: true });

  if (!fs.existsSync(CENSUS_PATH)) {
    console.error(`ERROR: census not found at ${CENSUS_PATH}. Run npm run census first.`);
    process.exit(1);
  }

  const census = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf-8')) as CensusFile;

  let candidates = census.laws.filter((l) => l.classification === 'ingestable');
  if (filter) {
    const needle = filter.toLowerCase();
    candidates = candidates.filter(
      (l) => l.title.toLowerCase().includes(needle) || l.nature_slug.includes(needle),
    );
  }
  if (!force) candidates = candidates.filter((l) => !l.ingested);
  if (limit !== null) candidates = candidates.slice(0, limit);

  console.log(`\nIngesting ${candidates.length} act(s)...`);

  let ok = 0;
  let failed = 0;
  let totalProvisions = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < candidates.length; i++) {
    const law = candidates[i]!;
    const seedPath = path.join(SEED_DIR, `${law.id}.json`);
    if (fs.existsSync(seedPath) && !force) {
      const existing = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as ParsedAct;
      const censusIndex = census.laws.findIndex((l) => l.id === law.id);
      if (censusIndex >= 0) {
        census.laws[censusIndex]!.ingested = true;
        census.laws[censusIndex]!.provision_count = existing.provisions.length;
        census.laws[censusIndex]!.ingestion_date ??= today;
      }
      ok += 1;
      totalProvisions += existing.provisions.length;
      continue;
    }

    const label = `[${i + 1}/${candidates.length}] ${law.identifier} — ${law.title.slice(0, 70)}`;
    try {
      const wp = await fetchTexte(law.wp_id);
      const { act } = buildAct(law, wp);
      writeSeed(act);
      const censusIndex = census.laws.findIndex((l) => l.id === law.id);
      if (censusIndex >= 0) {
        census.laws[censusIndex]!.ingested = true;
        census.laws[censusIndex]!.provision_count = act.provisions.length;
        census.laws[censusIndex]!.ingestion_date = today;
      }
      ok += 1;
      totalProvisions += act.provisions.length;
      console.log(`${label} -> ${act.provisions.length} provisions`);
    } catch (err) {
      failed += 1;
      console.log(`${label} FAILED: ${(err as Error).message}`);
      const censusIndex = census.laws.findIndex((l) => l.id === law.id);
      if (censusIndex >= 0) census.laws[censusIndex]!.classification = 'inaccessible';
    }

    if ((i + 1) % 25 === 0) {
      persistCensus(census);
    }
  }

  census.summary.ingested = census.laws.filter((l) => l.ingested).length;
  census.summary.inaccessible = census.laws.filter((l) => l.classification === 'inaccessible').length;
  persistCensus(census);

  console.log('\n---');
  console.log(`OK:              ${ok}`);
  console.log(`Failed:          ${failed}`);
  console.log(`Provisions:      ${totalProvisions}`);
  console.log(`Total ingested:  ${census.summary.ingested}/${census.summary.total_laws}`);
}

function persistCensus(census: CensusFile): void {
  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2), 'utf-8');
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
