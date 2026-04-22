#!/usr/bin/env tsx
/**
 * Djibouti Law MCP — Census Script
 *
 * Enumerates legal texts from the Journal Officiel de la République de Djibouti
 * (JORD) via its WordPress REST API at https://www.journalofficiel.dj/wp-json/.
 *
 * The JORD exposes two custom post types:
 *   - journal-officiel   JORD issue (container, ~2,100 rows)
 *   - texte-juridique    individual legal text (~57,000 rows)
 *
 * Natures we harvest by default (primary legal instruments):
 *   - loi               (~2,500)
 *   - loi-organique     (~15)
 *   - loi-de-finances   (~55)
 *   - ordonnance        (~215)
 *   - proclamation      (~8)
 *
 * Override via: --natures slug1,slug2,...
 *
 * Output: data/census.json (golden standard format)
 *
 * Usage:
 *   npx tsx scripts/census.ts
 *   npx tsx scripts/census.ts --limit 50
 *   npx tsx scripts/census.ts --natures loi,ordonnance
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchJson } from './lib/fetcher.js';
import { parseAcfDate, slugify, toIsoDate } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE = 'https://www.journalofficiel.dj/wp-json/wp/v2';
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');

/* ---------- Types ---------- */

interface WpNatureTerm {
  id: number;
  slug: string;
  name: string;
  count: number;
}

interface WpTexteJuridique {
  id: number;
  date: string;
  modified: string;
  slug: string;
  status: string;
  link: string;
  title: { rendered: string };
  'nature-dun-texte'?: number[];
  institution?: number[];
  acf?: {
    reference?: string;
    date?: string;
    comment?: string;
    fichiers?: unknown;
    journal_officiel?: number[];
  };
}

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

interface CliArgs {
  limit: number | null;
  natures: string[] | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let natures: string[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--natures' && args[i + 1]) {
      natures = args[i + 1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    }
  }
  return { limit, natures };
}

const DEFAULT_NATURES = ['loi', 'loi-organique', 'loi-de-finances', 'ordonnance', 'proclamation'];

async function fetchAllNatures(): Promise<WpNatureTerm[]> {
  const { data } = await fetchJson<WpNatureTerm[]>(`${BASE}/nature-dun-texte?per_page=100`);
  return data;
}

async function fetchTextesForNature(
  natureId: number,
  limit: number | null,
): Promise<WpTexteJuridique[]> {
  const out: WpTexteJuridique[] = [];
  const perPage = 100;
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const url = `${BASE}/texte-juridique?nature-dun-texte=${natureId}&per_page=${perPage}&page=${page}&_fields=id,date,modified,slug,status,link,title,nature-dun-texte,institution,acf`;
    const { data, result } = await fetchJson<WpTexteJuridique[]>(url);
    if (page === 1) {
      const tp = parseInt(result.headers['x-wp-totalpages'] ?? '1', 10);
      totalPages = Number.isFinite(tp) ? tp : 1;
    }
    out.push(...data);
    if (limit !== null && out.length >= limit) break;
    page += 1;
    if (data.length < perPage) break;
  }
  return limit !== null ? out.slice(0, limit) : out;
}

function titleToId(wpSlug: string, wpId: number): string {
  const slug = slugify(wpSlug, 150);
  return slug || `texte-${wpId}`;
}

function classifyContent(title: string): 'ingestable' | 'excluded' {
  return title.trim() ? 'ingestable' : 'excluded';
}

function toCensusLaw(wp: WpTexteJuridique, natureMap: Map<number, WpNatureTerm>): CensusLaw {
  const natureId = wp['nature-dun-texte']?.[0];
  const nature = natureId !== undefined ? natureMap.get(natureId) : undefined;
  const title = wp.title.rendered
    .replace(/<[^>]+>/g, '')
    .replace(/&rsquo;/g, '’')
    .replace(/&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .trim();
  const id = titleToId(wp.slug, wp.id);
  const ref = wp.acf?.reference?.trim();
  const issued = parseAcfDate(wp.acf?.date) || toIsoDate(wp.date);

  return {
    id,
    wp_id: wp.id,
    title,
    identifier: ref || `${nature?.name ?? 'Texte'} ${id}`,
    url: wp.link,
    nature: nature?.name ?? 'Texte juridique',
    nature_slug: nature?.slug ?? 'texte-juridique',
    institution_ids: Array.isArray(wp.institution) ? wp.institution : [],
    issued_date: issued,
    status: 'in_force',
    classification: classifyContent(title),
    ingested: false,
    provision_count: 0,
    ingestion_date: null,
    journal_officiel_ids: wp.acf?.journal_officiel ?? [],
  };
}

async function main(): Promise<void> {
  const { limit, natures } = parseArgs();
  const targetSlugs = natures ?? DEFAULT_NATURES;

  console.log('Djibouti Law MCP -- Census (JORD WP REST API)');
  console.log('=============================================');
  console.log(`  Portal:  https://www.journalofficiel.dj/`);
  console.log(`  API:     ${BASE}`);
  console.log(`  Natures: ${targetSlugs.join(', ')}`);
  if (limit !== null) console.log(`  --limit ${limit}`);
  console.log('');

  console.log('Fetching nature-dun-texte taxonomy...');
  const allNatures = await fetchAllNatures();
  const natureMap = new Map<number, WpNatureTerm>(allNatures.map((n) => [n.id, n]));
  const natureBySlug = new Map<string, WpNatureTerm>(allNatures.map((n) => [n.slug, n]));

  const naturesCovered: { slug: string; name: string; count: number }[] = [];
  const censusLaws: CensusLaw[] = [];
  const seen = new Set<string>();

  for (const slug of targetSlugs) {
    const nature = natureBySlug.get(slug);
    if (!nature) {
      console.log(`  [skip] nature ${slug} not found in taxonomy`);
      continue;
    }
    console.log(`\n[${nature.name} (${nature.slug})] count=${nature.count}`);
    const textes = await fetchTextesForNature(nature.id, limit);
    console.log(`  fetched ${textes.length} entries`);
    for (const wp of textes) {
      const law = toCensusLaw(wp, natureMap);
      if (seen.has(law.id)) continue;
      seen.add(law.id);
      censusLaws.push(law);
    }
    naturesCovered.push({ slug: nature.slug, name: nature.name, count: nature.count });
  }

  censusLaws.sort((a, b) => b.issued_date.localeCompare(a.issued_date));

  const summary = {
    total_laws: censusLaws.length,
    ingestable: censusLaws.filter((l) => l.classification === 'ingestable').length,
    excluded: censusLaws.filter((l) => l.classification === 'excluded').length,
    inaccessible: censusLaws.filter((l) => l.classification === 'inaccessible').length,
    ingested: 0,
  };

  const census: CensusFile = {
    schema_version: '2.0',
    jurisdiction: 'DJ',
    jurisdiction_name: 'Djibouti',
    portal: 'https://www.journalofficiel.dj',
    census_date: new Date().toISOString().slice(0, 10),
    agent: 'claude-opus-4-7',
    natures_covered: naturesCovered,
    summary,
    laws: censusLaws,
  };

  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2), 'utf-8');
  console.log('\n---');
  console.log(`Total enumerated: ${summary.total_laws}`);
  console.log(`Ingestable:       ${summary.ingestable}`);
  console.log(`Excluded:         ${summary.excluded}`);
  console.log(`Inaccessible:     ${summary.inaccessible}`);
  console.log(`Wrote ${CENSUS_PATH}`);
}

main().catch((err) => {
  console.error('Census failed:', err);
  process.exit(1);
});
