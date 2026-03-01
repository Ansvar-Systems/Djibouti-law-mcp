#!/usr/bin/env tsx
/**
 * Djibouti Law MCP -- Census Script
 *
 * Enumerates ALL proclamations, regulations, and directives from lawdjiboutian.com.
 * The site is a Joomla CMS with legislation organized by topic categories.
 * Most content is PDF-based (linked from HTML article pages).
 *
 * Sources scraped:
 *   1. /index.php/legislation/federal-legislation/{category} — topic category pages
 *   2. /index.php/proclamations-by-number — master proclamation listing
 *   3. /index.php/volume-3 (paginated) — newer laws
 *   4. /index.php/federal-laws (paginated) — additional recent laws
 *
 * Output: data/census.json (golden standard format)
 *
 * Usage:
 *   npx tsx scripts/census.ts
 *   npx tsx scripts/census.ts --limit 10   # Test with first 10 pages only
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithRateLimit } from './lib/fetcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://www.lawdjiboutian.com';
const CENSUS_PATH = path.resolve(__dirname, '../data/census.json');

/* ---------- Types ---------- */

interface RawLaw {
  title: string;
  pageUrl: string;      // The HTML article page URL
  pdfUrl: string | null; // Direct PDF URL if found
  category: string;
  procNumber: string | null;
  procYear: string | null;
}

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

/* ---------- Federal legislation categories ---------- */

const FEDERAL_CATEGORIES = [
  'advocates', 'agriculture', 'anti-corruption', 'audit-accounting',
  'banking-and-monetary-system/national-bank-of-djiboutian',
  'banking-and-monetary-system/banking-business',
  'banking-and-monetary-system/insurance-business',
  'banking-and-monetary-system/micro-finance-business',
  'banking-and-monetary-system/forex-directive',
  'banking-and-monetary-system/capital-market',
  'banking-and-monetary-system/capital-goods-lease-finance',
  'banking-and-monetary-system/movable-collateral',
  'civil-societies-charities', 'constitution', 'construction-housing',
  'cooperatives', 'chartered-cities', 'court', 'culture-and-sport',
  'defence', 'education-art-and-relics', 'election',
  'flag-emblem-national-anthem', 'health', 'house-of-federation',
  'human-rights', 'industry', 'intellectual-property', 'internal-affairs',
  'investment', 'labor-law', 'land-administration', 'media-law',
  'mining', 'ministries-and-public-administration',
  'nationality-and-foreigners', 'natural-resources-environment',
  'parliament', 'police', 'president-of-djiboutian', 'prison',
  'prosecution', 'public-finance', 'public-notary', 'public-services',
  'public-utilities', 'religion', 'rural-land', 'science-and-technology',
  'social-affairs', 'special-offenses-procedures', 'stastics',
  'tax-laws/custom-duty', 'tax-laws/excise-tax', 'tax-laws/income-tax',
  'tax-laws/stamp-duty', 'tax-laws/sur-tax',
  'tax-laws/tax-directives/custom-directives',
  'tax-laws/tax-directives/erca-circulars',
  'tax-laws/tax-directives/miscellaneous-directives',
  'tax-laws/turnover-tax', 'tax-laws/vat-tax',
  'telecommunication-and-digitization-laws', 'trade-and-business',
  'transportation-and-communication', 'urban-land',
];

/* ---------- HTML extraction helpers ---------- */

function extractArticleLinks(html: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];

  // Extract links from the article-content section
  const contentMatch = html.match(/<section class="article-content[^"]*">([\s\S]*?)<\/section>/);
  if (contentMatch) {
    const content = contentMatch[1];
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)</g;
    let match: RegExpExecArray | null;
    while ((match = linkRe.exec(content)) !== null) {
      const href = match[1].replace(/&amp;/g, '&');
      const text = match[2].trim();
      if (text && href) {
        links.push({ href, text });
      }
    }
  }

  return links;
}

function extractCategoryListingLinks(html: string): { href: string; text: string }[] {
  const links: { href: string; text: string }[] = [];

  // Joomla category listing uses items-row or blog format
  // Look for article title links
  const titleRe = /<h\d[^>]*class="[^"]*article-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]*)</g;
  let match: RegExpExecArray | null;
  while ((match = titleRe.exec(html)) !== null) {
    const href = match[1].replace(/&amp;/g, '&');
    const text = match[2].trim();
    if (text && href) {
      links.push({ href, text });
    }
  }

  return links;
}

function extractPaginationMax(html: string): number {
  // Look for pagination links like ?start=210
  const paginationRe = /\?start=(\d+)/g;
  let maxStart = 0;
  let match: RegExpExecArray | null;
  while ((match = paginationRe.exec(html)) !== null) {
    const start = parseInt(match[1], 10);
    if (start > maxStart) maxStart = start;
  }
  return maxStart;
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.pdf');
}

function extractProcNumber(title: string): { number: string | null; year: string | null } {
  // Match patterns like:
  //   "Proclamation No. 1284/2023"
  //   "proclamation no. 958"
  //   "Proc. No. 1/1995"
  //   "Proclamation no. 983"
  const procRe = /(?:proclamation|proc\.?)\s*(?:no\.?\s*)?(\d+)(?:[/_](\d{4}|\d{2}))?/i;
  const match = title.match(procRe);
  if (match) {
    return { number: match[1], year: match[2] ?? null };
  }
  // Also match "Regulation No. XXX/YYYY"
  const regRe = /regulation\s*(?:no\.?\s*)?(\d+)(?:[/_](\d{4}|\d{2}))?/i;
  const regMatch = title.match(regRe);
  if (regMatch) {
    return { number: regMatch[1], year: regMatch[2] ?? null };
  }
  return { number: null, year: null };
}

function buildLawId(title: string, procNum: string | null, procYear: string | null): string {
  // Build a stable, readable ID from title components
  if (procNum) {
    const yearSuffix = procYear ? `-${procYear}` : '';
    return `proc-${procNum}${yearSuffix}`;
  }
  // Fall back to slugified title
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

function cleanTitle(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

/* ---------- Scraping functions ---------- */

async function scrapeCategoryPage(categoryPath: string): Promise<RawLaw[]> {
  const url = `${BASE_URL}/index.php/legislation/federal-legislation/${categoryPath}`;
  const result = await fetchWithRateLimit(url);
  if (result.status !== 200) {
    console.log(`  WARNING: HTTP ${result.status} for ${categoryPath}`);
    return [];
  }

  const html = result.body;
  const laws: RawLaw[] = [];
  const links = extractArticleLinks(html);

  // The category name is the last segment
  const catName = categoryPath.split('/').pop() ?? categoryPath;

  for (const link of links) {
    // Skip external links (google docs, external sites)
    if (link.href.startsWith('http') && !link.href.includes('lawdjiboutian.com')) continue;
    // Skip non-legislation links
    if (link.href.includes('/case-law/') || link.href.includes('/case-reports')) continue;
    // Skip empty titles
    if (!link.text || link.text.length < 3) continue;

    const title = cleanTitle(link.text);
    const pdfUrl = isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : null;
    const pageUrl = !isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : '';
    const { number: procNumber, year: procYear } = extractProcNumber(title);

    laws.push({
      title,
      pageUrl: pageUrl || (pdfUrl ? '' : ''),
      pdfUrl,
      category: catName,
      procNumber,
      procYear,
    });
  }

  return laws;
}

async function scrapeProclamationsByNumber(): Promise<RawLaw[]> {
  const url = `${BASE_URL}/index.php/proclamations-by-number`;
  const result = await fetchWithRateLimit(url);
  if (result.status !== 200) {
    console.log(`  WARNING: HTTP ${result.status} for proclamations-by-number`);
    return [];
  }

  const html = result.body;
  const links = extractArticleLinks(html);
  const laws: RawLaw[] = [];

  for (const link of links) {
    if (link.href.startsWith('http') && !link.href.includes('lawdjiboutian.com')) continue;
    if (!link.text || link.text.length < 3) continue;

    const title = cleanTitle(link.text);
    const pdfUrl = isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : null;
    const pageUrl = !isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : '';
    const { number: procNumber, year: procYear } = extractProcNumber(title);

    laws.push({
      title,
      pageUrl: pageUrl || '',
      pdfUrl,
      category: 'proclamations-by-number',
      procNumber,
      procYear,
    });
  }

  return laws;
}

async function scrapePaginatedCategory(basePath: string, categoryName: string): Promise<RawLaw[]> {
  const url = `${BASE_URL}${basePath}`;
  const result = await fetchWithRateLimit(url);
  if (result.status !== 200) {
    console.log(`  WARNING: HTTP ${result.status} for ${basePath}`);
    return [];
  }

  const laws: RawLaw[] = [];
  const maxStart = extractPaginationMax(result.body);

  // Process first page
  const firstPageLinks = extractCategoryListingLinks(result.body);
  // Also check for article-content links (some pages have both)
  const articleLinks = extractArticleLinks(result.body);
  const allLinks = [...firstPageLinks, ...articleLinks];

  for (const link of allLinks) {
    if (link.href.startsWith('http') && !link.href.includes('lawdjiboutian.com')) continue;
    if (!link.text || link.text.length < 3) continue;

    const title = cleanTitle(link.text);
    const pdfUrl = isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : null;
    const pageUrl = !isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : '';
    const { number: procNumber, year: procYear } = extractProcNumber(title);

    laws.push({ title, pageUrl: pageUrl || '', pdfUrl, category: categoryName, procNumber, procYear });
  }

  // Paginated pages
  if (maxStart > 0) {
    for (let start = 10; start <= maxStart; start += 10) {
      const pageUrl = `${url}?start=${start}`;
      const pageResult = await fetchWithRateLimit(pageUrl);
      if (pageResult.status !== 200) continue;

      const pageLinks = extractCategoryListingLinks(pageResult.body);
      for (const link of pageLinks) {
        if (link.href.startsWith('http') && !link.href.includes('lawdjiboutian.com')) continue;
        if (!link.text || link.text.length < 3) continue;

        const title = cleanTitle(link.text);
        const pdf = isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : null;
        const page = !isPdfUrl(link.href) ? (link.href.startsWith('/') ? `${BASE_URL}${link.href}` : link.href) : '';
        const { number: procNumber, year: procYear } = extractProcNumber(title);

        laws.push({ title, pageUrl: page || '', pdfUrl: pdf, category: categoryName, procNumber, procYear });
      }
    }
  }

  return laws;
}

/**
 * For HTML article pages that just contain a PDF link, resolve the PDF URL.
 */
async function resolvePdfFromPage(pageUrl: string): Promise<string | null> {
  if (!pageUrl) return null;

  const result = await fetchWithRateLimit(pageUrl);
  if (result.status !== 200) return null;

  const contentMatch = result.body.match(/<section class="article-content[^"]*">([\s\S]*?)<\/section>/);
  if (!contentMatch) return null;

  const content = contentMatch[1];
  const pdfRe = /href="([^"]*\.pdf)"/i;
  const match = content.match(pdfRe);
  if (match) {
    const pdfHref = match[1].replace(/&amp;/g, '&');
    return pdfHref.startsWith('/') ? `${BASE_URL}${pdfHref}` : pdfHref;
  }

  return null;
}

/* ---------- Deduplication ---------- */

function deduplicateLaws(allLaws: RawLaw[]): RawLaw[] {
  // Deduplicate by:
  //   1. Proclamation number (if available) — prefer entry with PDF URL
  //   2. Normalized title — prefer entry with PDF URL
  const byProcNumber = new Map<string, RawLaw>();
  const byTitle = new Map<string, RawLaw>();
  const result: RawLaw[] = [];

  for (const law of allLaws) {
    if (law.procNumber) {
      const key = law.procNumber;
      const existing = byProcNumber.get(key);
      if (!existing) {
        byProcNumber.set(key, law);
      } else {
        // Prefer the one with a PDF URL
        if (!existing.pdfUrl && law.pdfUrl) {
          byProcNumber.set(key, { ...law, category: existing.category });
        }
        // Prefer longer title
        if (law.title.length > existing.title.length) {
          byProcNumber.set(key, { ...law, pdfUrl: law.pdfUrl ?? existing.pdfUrl, category: existing.category });
        }
      }
    } else {
      // No proclamation number — dedupe by normalized title
      const normTitle = law.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = byTitle.get(normTitle);
      if (!existing) {
        byTitle.set(normTitle, law);
      } else {
        if (!existing.pdfUrl && law.pdfUrl) {
          byTitle.set(normTitle, { ...law, category: existing.category });
        }
      }
    }
  }

  result.push(...byProcNumber.values());
  result.push(...byTitle.values());
  return result;
}

/* ---------- Main ---------- */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let limitPages = 0; // 0 = no limit
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limitPages = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log('Djibouti Law MCP -- Census Script');
  console.log('=================================\n');
  console.log(`  Source: ${BASE_URL}`);
  if (limitPages) console.log(`  --limit ${limitPages} (testing mode)`);

  const allLaws: RawLaw[] = [];

  // Phase 1: Scrape federal legislation category pages
  console.log('\n  Phase 1: Federal legislation categories...');
  const categories = limitPages ? FEDERAL_CATEGORIES.slice(0, limitPages) : FEDERAL_CATEGORIES;
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    process.stdout.write(`    [${i + 1}/${categories.length}] ${cat}...`);
    const laws = await scrapeCategoryPage(cat);
    allLaws.push(...laws);
    console.log(` ${laws.length} laws`);
  }

  // Phase 2: Scrape proclamations-by-number
  console.log('\n  Phase 2: Proclamations by number...');
  const procByNumber = await scrapeProclamationsByNumber();
  allLaws.push(...procByNumber);
  console.log(`    Found ${procByNumber.length} entries`);

  // Phase 3: Scrape volume-3 (paginated)
  console.log('\n  Phase 3: Volume 3 (recent laws, paginated)...');
  const vol3 = await scrapePaginatedCategory('/index.php/volume-3', 'volume-3');
  allLaws.push(...vol3);
  console.log(`    Found ${vol3.length} entries`);

  // Phase 4: Scrape federal-laws (paginated)
  console.log('\n  Phase 4: Federal laws (paginated)...');
  const fedLaws = await scrapePaginatedCategory('/index.php/federal-laws', 'federal-laws');
  allLaws.push(...fedLaws);
  console.log(`    Found ${fedLaws.length} entries`);

  console.log(`\n  Total raw entries: ${allLaws.length}`);

  // Deduplicate
  const dedupedLaws = deduplicateLaws(allLaws);
  console.log(`  After deduplication: ${dedupedLaws.length}`);

  // Phase 5: For laws without PDF URLs, resolve from their HTML article pages
  // (Do a sample to estimate PDF resolution rate, then process all)
  let pdfResolved = 0;
  let withoutPdf = dedupedLaws.filter(l => !l.pdfUrl && l.pageUrl);
  console.log(`\n  Phase 5: Resolving PDF URLs from ${withoutPdf.length} article pages...`);

  for (let i = 0; i < withoutPdf.length; i++) {
    const law = withoutPdf[i];
    if (i % 20 === 0 && i > 0) {
      process.stdout.write(`    [${i}/${withoutPdf.length}] resolved ${pdfResolved} PDFs so far...\n`);
    }
    const pdfUrl = await resolvePdfFromPage(law.pageUrl);
    if (pdfUrl) {
      law.pdfUrl = pdfUrl;
      pdfResolved++;
    }
  }
  console.log(`    Resolved ${pdfResolved}/${withoutPdf.length} PDF URLs`);

  // Build census entries
  const today = new Date().toISOString().split('T')[0];
  const censusLaws: CensusLawEntry[] = [];

  for (const law of dedupedLaws) {
    const { number: procNumber, year: procYear } = extractProcNumber(law.title);
    const id = buildLawId(law.title, procNumber, procYear);
    const url = law.pdfUrl ?? law.pageUrl ?? '';

    // Classify: if we have a PDF URL, it is ingestable. Otherwise it may be inaccessible.
    let classification: 'ingestable' | 'excluded' | 'inaccessible' = 'inaccessible';
    if (law.pdfUrl) {
      classification = 'ingestable';
    } else if (law.pageUrl) {
      classification = 'ingestable'; // We can try to parse the HTML page
    }

    // Generate identifier in act/YEAR/NUMBER format
    let identifier = '';
    if (procNumber && procYear) {
      identifier = `act/${procYear}/${procNumber}`;
    } else if (procNumber) {
      identifier = `act/0/${procNumber}`;
    } else {
      identifier = `act/0/${id}`;
    }

    censusLaws.push({
      id,
      title: law.title,
      identifier,
      url,
      pdf_url: law.pdfUrl,
      status: 'in_force',
      category: law.category,
      classification,
      ingested: false,
      provision_count: 0,
      ingestion_date: null,
    });
  }

  // Deduplicate by ID (in case of collisions)
  const byId = new Map<string, CensusLawEntry>();
  for (const law of censusLaws) {
    const existing = byId.get(law.id);
    if (!existing) {
      byId.set(law.id, law);
    } else {
      // Prefer the one with a PDF URL
      if (!existing.pdf_url && law.pdf_url) {
        byId.set(law.id, law);
      }
    }
  }
  const finalLaws = Array.from(byId.values()).sort((a, b) => a.title.localeCompare(b.title));
  const ingestable = finalLaws.filter(l => l.classification === 'ingestable').length;
  const inaccessible = finalLaws.filter(l => l.classification === 'inaccessible').length;
  const excluded = finalLaws.filter(l => l.classification === 'excluded').length;

  const census: CensusFile = {
    schema_version: '2.0',
    jurisdiction: 'ET',
    jurisdiction_name: 'Djibouti',
    portal: BASE_URL,
    census_date: today,
    agent: 'census.ts',
    summary: {
      total_laws: finalLaws.length,
      ingestable,
      ocr_needed: 0,
      inaccessible,
      excluded,
    },
    laws: finalLaws,
  };

  // Write census.json
  fs.mkdirSync(path.dirname(CENSUS_PATH), { recursive: true });
  fs.writeFileSync(CENSUS_PATH, JSON.stringify(census, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log('Census Report');
  console.log('='.repeat(60));
  console.log(`  Jurisdiction:   Djibouti (ET)`);
  console.log(`  Source:         ${BASE_URL}`);
  console.log(`  Census date:    ${today}`);
  console.log(`  Total laws:     ${finalLaws.length}`);
  console.log(`  Ingestable:     ${ingestable}`);
  console.log(`  Inaccessible:   ${inaccessible}`);
  console.log(`  Excluded:       ${excluded}`);
  console.log(`  With PDF URL:   ${finalLaws.filter(l => l.pdf_url).length}`);
  console.log(`\n  Output: ${CENSUS_PATH}`);
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
