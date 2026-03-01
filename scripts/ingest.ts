#!/usr/bin/env tsx
/**
 * Djibouti Law MCP -- Census-Driven Ingestion Pipeline (PDF-based)
 *
 * Reads data/census.json and fetches + parses every ingestable Act
 * from lawdjiboutian.com. Djiboutian proclamations are published as PDFs.
 *
 * Pipeline per act:
 *   1. Download PDF from the resolved URL
 *   2. Extract text using pdftotext (poppler-utils)
 *   3. Parse extracted text to identify articles, definitions, structure
 *   4. Write seed JSON for the database builder
 *
 * Features:
 *   - Resume support: skips Acts that already have a seed JSON file
 *   - Census update: writes provision counts + ingestion dates back to census.json
 *   - Rate limiting: 500ms minimum between requests (via fetcher.ts)
 *   - PDF text extraction via pdftotext (must be installed)
 *
 * Usage:
 *   npm run ingest                    # Full census-driven ingestion
 *   npm run ingest -- --limit 5       # Test with 5 acts
 *   npm run ingest -- --skip-fetch    # Reuse cached PDFs (re-parse only)
 *   npm run ingest -- --force         # Re-ingest even if seed exists
 *
 * Data source: lawdjiboutian.com (Federal Negarit Gazette)
 * Format: PDF (bilingual Amharic/English)
 * License: Government Open Data
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { fetchWithRateLimit } from './lib/fetcher.js';
import { parsePdfText, type ActIndexEntry, type ParsedAct } from './lib/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_DIR = path.resolve(__dirname, '../data/pdf');
const TEXT_DIR = path.resolve(__dirname, '../data/text');
const SEED_DIR = path.resolve(__dirname, '../data/seed');
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');

/* ---------- Types ---------- */

interface CensusLawEntry {
  id: string;
  title: string;
  identifier: string;
  url: string;
  pdf_url: string | null;
  status: 'in_force' | 'amended' | 'repealed';
  category: string;
  classification: 'ingestable' | 'excluded' | 'inaccessible';
  ingested: boolean;
  provision_count: number;
  ingestion_date: string | null;
}

interface CensusFile {
  schema_version: string;
  jurisdiction: string;
  jurisdiction_name: string;
  portal: string;
  census_date: string;
  agent: string;
  summary: {
    total_laws: number;
    ingestable: number;
    ocr_needed: number;
    inaccessible: number;
    excluded: number;
  };
  laws: CensusLawEntry[];
}

/* ---------- Helpers ---------- */

function parseArgs(): { limit: number | null; skipFetch: boolean; force: boolean } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let skipFetch = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--skip-fetch') {
      skipFetch = true;
    } else if (args[i] === '--force') {
      force = true;
    }
  }

  return { limit, skipFetch, force };
}

/** Check that pdftotext is available */
function checkPdftotext(): boolean {
  try {
    execSync('pdftotext -v 2>&1', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Extract text from PDF using pdftotext */
function extractPdfText(pdfPath: string, textPath: string): string {
  try {
    // Redirect stderr to /dev/null -- Ethiopic ligature warnings from
    // bilingual Amharic/English PDFs can exceed Node's default maxBuffer
    execSync(`pdftotext "${pdfPath}" "${textPath}" 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return fs.readFileSync(textPath, 'utf-8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`pdftotext failed for ${pdfPath}: ${msg}`);
  }
}

/** Download a PDF file */
async function downloadPdf(url: string, outputPath: string): Promise<{ status: number; size: number }> {
  const result = await fetchWithRateLimit(url);
  if (result.status !== 200) {
    return { status: result.status, size: 0 };
  }

  // Check if it's actually a PDF (not an HTML error page)
  if (result.contentType.includes('text/html') && result.body.includes('<!DOCTYPE')) {
    return { status: 404, size: 0 };
  }

  // Write the raw response body as binary
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'djiboutian-law-mcp/1.0 (https://github.com/Ansvar-Systems/djiboutian-law-mcp; hello@ansvar.ai)',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    return { status: response.status, size: 0 };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  // Verify it's actually a PDF
  if (buffer.length < 100 || !buffer.subarray(0, 5).toString().startsWith('%PDF')) {
    fs.unlinkSync(outputPath);
    return { status: 415, size: 0 }; // Unsupported Media Type
  }

  return { status: 200, size: buffer.length };
}

/**
 * Convert a census entry to an ActIndexEntry for the parser.
 */
function censusToActEntry(law: CensusLawEntry): ActIndexEntry {
  return {
    id: law.id,
    title: law.title,
    titleEn: law.title,
    shortName: law.title.length > 60 ? law.title.substring(0, 57) + '...' : law.title,
    status: law.status === 'in_force' ? 'in_force' : law.status === 'amended' ? 'amended' : 'repealed',
    issuedDate: '',
    inForceDate: '',
    url: law.url,
  };
}

/* ---------- Main ---------- */

async function main(): Promise<void> {
  const { limit, skipFetch, force } = parseArgs();

  console.log('Djibouti Law MCP -- Ingestion Pipeline (PDF-based)');
  console.log('===================================================\n');
  console.log(`  Source: lawdjiboutian.com (Federal Negarit Gazette)`);
  console.log(`  Format: PDF (bilingual Amharic/English)`);
  console.log(`  License: Government Open Data`);

  if (limit) console.log(`  --limit ${limit}`);
  if (skipFetch) console.log(`  --skip-fetch`);
  if (force) console.log(`  --force (re-ingest all)`);

  // Check pdftotext
  if (!checkPdftotext()) {
    console.error('\nERROR: pdftotext not found. Install poppler-utils:');
    console.error('  sudo apt-get install poppler-utils');
    process.exit(1);
  }

  // Load census
  if (!fs.existsSync(CENSUS_PATH)) {
    console.error(`\nERROR: Census file not found at ${CENSUS_PATH}`);
    console.error('Run "npx tsx scripts/census.ts" first.');
    process.exit(1);
  }

  const census: CensusFile = JSON.parse(fs.readFileSync(CENSUS_PATH, 'utf-8'));
  const ingestable = census.laws.filter(l => l.classification === 'ingestable');
  const acts = limit ? ingestable.slice(0, limit) : ingestable;

  console.log(`\n  Census: ${census.summary.total_laws} total, ${ingestable.length} ingestable`);
  console.log(`  Processing: ${acts.length} acts\n`);

  fs.mkdirSync(PDF_DIR, { recursive: true });
  fs.mkdirSync(TEXT_DIR, { recursive: true });
  fs.mkdirSync(SEED_DIR, { recursive: true });

  let processed = 0;
  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let totalProvisions = 0;
  let totalDefinitions = 0;
  const results: { act: string; provisions: number; definitions: number; status: string }[] = [];

  // Build a map for census updates
  const censusMap = new Map<string, CensusLawEntry>();
  for (const law of census.laws) {
    censusMap.set(law.id, law);
  }

  const today = new Date().toISOString().split('T')[0];

  for (const law of acts) {
    const act = censusToActEntry(law);
    const pdfFile = path.join(PDF_DIR, `${act.id}.pdf`);
    const textFile = path.join(TEXT_DIR, `${act.id}.txt`);
    const seedFile = path.join(SEED_DIR, `${act.id}.json`);
    const pdfUrl = law.pdf_url ?? law.url;

    // Resume support: skip if seed already exists (unless --force)
    if (!force && fs.existsSync(seedFile)) {
      try {
        const existing = JSON.parse(fs.readFileSync(seedFile, 'utf-8')) as ParsedAct;
        const provCount = existing.provisions?.length ?? 0;
        const defCount = existing.definitions?.length ?? 0;
        totalProvisions += provCount;
        totalDefinitions += defCount;

        // Update census entry
        const entry = censusMap.get(law.id);
        if (entry) {
          entry.ingested = true;
          entry.provision_count = provCount;
          entry.ingestion_date = entry.ingestion_date ?? today;
        }

        results.push({ act: act.shortName, provisions: provCount, definitions: defCount, status: 'resumed' });
        skipped++;
        processed++;
        continue;
      } catch {
        // Corrupt seed file, re-ingest
      }
    }

    try {
      // Step 1: Download PDF
      if (!skipFetch || !fs.existsSync(pdfFile)) {
        if (!pdfUrl || (!pdfUrl.endsWith('.pdf') && !law.pdf_url)) {
          // No PDF URL available — try the page URL and see if it resolves to a PDF
          console.log(`  [${processed + 1}/${acts.length}] ${act.id}: No PDF URL, skipping`);
          const entry = censusMap.get(law.id);
          if (entry) entry.classification = 'inaccessible';
          results.push({ act: act.shortName, provisions: 0, definitions: 0, status: 'no-pdf' });
          failed++;
          processed++;
          continue;
        }

        process.stdout.write(`  [${processed + 1}/${acts.length}] Downloading ${act.id}...`);
        const dlResult = await downloadPdf(pdfUrl, pdfFile);

        if (dlResult.status !== 200) {
          console.log(` HTTP ${dlResult.status}`);
          const entry = censusMap.get(law.id);
          if (entry) entry.classification = 'inaccessible';
          results.push({ act: act.shortName, provisions: 0, definitions: 0, status: `HTTP ${dlResult.status}` });
          failed++;
          processed++;
          continue;
        }
        console.log(` OK (${(dlResult.size / 1024).toFixed(0)} KB)`);
      } else {
        console.log(`  [${processed + 1}/${acts.length}] Using cached PDF ${act.id}`);
      }

      // Step 2: Extract text
      process.stdout.write(`    Extracting text...`);
      const text = extractPdfText(pdfFile, textFile);
      console.log(` ${text.length} chars, ${text.split('\n').length} lines`);

      // Skip very short extractions (likely scanned/image PDFs)
      if (text.trim().length < 100) {
        console.log(`    WARNING: Very short text extraction — possible scanned/image PDF`);
        const entry = censusMap.get(law.id);
        if (entry) entry.classification = 'inaccessible';
        results.push({ act: act.shortName, provisions: 0, definitions: 0, status: 'too-short' });
        failed++;
        processed++;
        continue;
      }

      // Step 3: Parse
      const parsed = parsePdfText(text, act);
      fs.writeFileSync(seedFile, JSON.stringify(parsed, null, 2));
      totalProvisions += parsed.provisions.length;
      totalDefinitions += parsed.definitions.length;
      console.log(`    -> ${parsed.provisions.length} provisions, ${parsed.definitions.length} definitions`);

      // Update census entry
      const entry = censusMap.get(law.id);
      if (entry) {
        entry.ingested = true;
        entry.provision_count = parsed.provisions.length;
        entry.ingestion_date = today;
      }

      results.push({
        act: act.shortName,
        provisions: parsed.provisions.length,
        definitions: parsed.definitions.length,
        status: 'OK',
      });
      ingested++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR: ${act.id}: ${msg.substring(0, 120)}`);
      results.push({ act: act.shortName, provisions: 0, definitions: 0, status: `ERROR: ${msg.substring(0, 80)}` });
      failed++;
    }

    processed++;

    // Save census every 50 acts (checkpoint)
    if (processed % 50 === 0) {
      writeCensus(census, censusMap);
      console.log(`  [checkpoint] Census updated at ${processed}/${acts.length}`);
    }
  }

  // Final census update
  writeCensus(census, censusMap);

  // Report
  console.log(`\n${'='.repeat(70)}`);
  console.log('Ingestion Report');
  console.log('='.repeat(70));
  console.log(`\n  Source:      lawdjiboutian.com (Federal Negarit Gazette PDFs)`);
  console.log(`  Processed:   ${processed}`);
  console.log(`  New:         ${ingested}`);
  console.log(`  Resumed:     ${skipped}`);
  console.log(`  Failed:      ${failed}`);
  console.log(`  Total provisions:  ${totalProvisions}`);
  console.log(`  Total definitions: ${totalDefinitions}`);

  // Summary of failures
  const failures = results.filter(r =>
    r.status.startsWith('HTTP') || r.status.startsWith('ERROR') ||
    r.status === 'no-pdf' || r.status === 'too-short'
  );
  if (failures.length > 0) {
    console.log(`\n  Failed acts (${failures.length}):`);
    for (const f of failures.slice(0, 30)) {
      console.log(`    ${f.act}: ${f.status}`);
    }
    if (failures.length > 30) {
      console.log(`    ... and ${failures.length - 30} more`);
    }
  }

  // Zero-provision acts
  const zeroProv = results.filter(r =>
    r.provisions === 0 && r.status === 'OK'
  );
  if (zeroProv.length > 0) {
    console.log(`\n  Zero-provision acts (${zeroProv.length}):`);
    for (const z of zeroProv.slice(0, 20)) {
      console.log(`    ${z.act}`);
    }
    if (zeroProv.length > 20) {
      console.log(`    ... and ${zeroProv.length - 20} more`);
    }
  }

  console.log('');
}

function writeCensus(census: CensusFile, censusMap: Map<string, CensusLawEntry>): void {
  // Update the laws array from the map
  census.laws = Array.from(censusMap.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );

  // Recalculate summary
  census.summary.total_laws = census.laws.length;
  census.summary.ingestable = census.laws.filter(l => l.classification === 'ingestable').length;
  census.summary.inaccessible = census.laws.filter(l => l.classification === 'inaccessible').length;
  census.summary.excluded = census.laws.filter(l => l.classification === 'excluded').length;

  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
