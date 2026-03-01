/**
 * Djibouti Law PDF Parser
 *
 * Parses text extracted from Djiboutian proclamation PDFs (Federal Negarit Gazette).
 * Most proclamations are bilingual (Amharic + English); this parser extracts
 * English text where available and falls back to Amharic otherwise.
 *
 * Article identification:
 *   - Articles are numbered as "N. Title" at the start of a line
 *   - Parts/chapters as "PART ONE", "CHAPTER TWO" etc.
 *   - Sub-articles as "1/", "2/", etc.
 *   - Sub-sub-articles as "a)", "b)", etc.
 *
 * Source: lawdjiboutian.com (Federal Negarit Gazette PDFs)
 */

export interface ActIndexEntry {
  id: string;
  title: string;
  titleEn: string;
  shortName: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  issuedDate: string;
  inForceDate: string;
  url: string;
  description?: string;
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title: string;
  content: string;
}

export interface ParsedDefinition {
  term: string;
  definition: string;
  source_provision?: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  title_en: string;
  short_name: string;
  status: string;
  issued_date: string;
  in_force_date: string;
  url: string;
  description?: string;
  provisions: ParsedProvision[];
  definitions: ParsedDefinition[];
}

/* ---------- Language detection ---------- */

/** Check if a line is primarily Amharic (Ethiopic script) */
function isAmharicLine(line: string): boolean {
  const ethiopicChars = (line.match(/[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/g) || []).length;
  const latinChars = (line.match(/[A-Za-z]/g) || []).length;
  // If more than 40% of chars are Ethiopic and there are at least some
  return ethiopicChars > 3 && ethiopicChars > latinChars * 0.5;
}

/** Check if a line has substantial English text */
function isEnglishLine(line: string): boolean {
  const words = line.split(/\s+/).filter(w => /^[A-Za-z]/.test(w));
  return words.length >= 2;
}

/**
 * Determine if the document is bilingual (has substantial English content).
 * If bilingual, we extract English only. If not, we keep Amharic.
 */
function isBilingual(lines: string[]): boolean {
  let englishLines = 0;
  let totalLines = 0;
  for (const line of lines) {
    if (line.trim().length < 3) continue;
    totalLines++;
    if (isEnglishLine(line)) englishLines++;
  }
  // If more than 15% of lines have English, consider it bilingual
  return totalLines > 0 && englishLines / totalLines > 0.15;
}

/* ---------- Text cleaning ---------- */

/** Remove page headers/footers and clean up PDF extraction artifacts */
function cleanPdfText(text: string): string {
  let cleaned = text
    // Remove page number lines
    .replace(/^\s*\d+\s*$/gm, '')
    // Remove Federal Negarit Gazette headers
    .replace(/^\s*(?:ፌደራል ነጋሪት ጋዜጣ|FEDERAL NEGARIT GAZETTE)\s*$/gm, '')
    // Remove "page" references
    .replace(/page\s*…*\s*\d+/gi, '')
    // Remove form feed characters
    .replace(/\f/g, '\n')
    // Collapse triple+ newlines into double
    .replace(/\n{3,}/g, '\n\n');

  return cleaned;
}

/** Filter to English-only content from bilingual text */
function extractEnglishContent(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      result.push('');
      continue;
    }
    // Keep lines that are English or look like article numbers
    if (isEnglishLine(trimmed) || /^\d+[\./]/.test(trimmed) || /^[a-z]\)/.test(trimmed)) {
      // Skip lines that are predominantly Amharic
      if (!isAmharicLine(trimmed)) {
        result.push(trimmed);
      }
    }
    // Keep structural markers in English
    if (/^(PART|CHAPTER|SECTION|SCHEDULE|APPENDIX)\s/i.test(trimmed) && !isAmharicLine(trimmed)) {
      if (!result.includes(trimmed)) {
        result.push(trimmed);
      }
    }
  }
  return result;
}

/* ---------- Structural parsing ---------- */

interface RawArticle {
  number: number;
  title: string;
  content: string[];
  part: string;
  chapter: string;
}

/**
 * Parse articles from the extracted text lines.
 * Articles follow the pattern: "N. Title" or "N.Title" at the start of a line.
 *
 * In bilingual PDFs, each article appears twice (Amharic then English).
 * We detect duplicates and keep the English version (or the one with more Latin text).
 */
function parseArticles(lines: string[]): RawArticle[] {
  const allArticles: RawArticle[] = [];
  let currentPart = '';
  let currentChapter = '';
  let currentArticle: RawArticle | null = null;

  // Regex for article start: "N. Title" or "N.Title" at line start
  const articleRe = /^(\d+)\.\s*(.*)/;
  const partRe = /^PART\s+(\w+)/i;
  const chapterRe = /^CHAPTER\s+(\w+)/i;
  const sectionRe = /^SECTION\s+(\w+)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (currentArticle) {
        currentArticle.content.push('');
      }
      continue;
    }

    // Check for Part (English)
    const partMatch = trimmed.match(partRe);
    if (partMatch && !isAmharicLine(trimmed)) {
      currentPart = trimmed;
      continue;
    }

    // Check for Chapter or Section (structural, English)
    const chapterMatch = trimmed.match(chapterRe) || trimmed.match(sectionRe);
    if (chapterMatch && !isAmharicLine(trimmed)) {
      currentChapter = trimmed;
      continue;
    }

    // Check for article start
    const articleMatch = trimmed.match(articleRe);
    if (articleMatch) {
      const num = parseInt(articleMatch[1], 10);
      const title = articleMatch[2].trim();

      // Only treat as a new article if the number is reasonable
      if (num >= 1 && num <= 500) {
        if (currentArticle) {
          allArticles.push(currentArticle);
        }
        currentArticle = {
          number: num,
          title,
          content: [],
          part: currentPart,
          chapter: currentChapter,
        };
        continue;
      }
    }

    // Add line to current article
    if (currentArticle) {
      currentArticle.content.push(trimmed);
    }
  }

  // Push the last article
  if (currentArticle) {
    allArticles.push(currentArticle);
  }

  // Deduplicate: in bilingual PDFs, each article number appears twice.
  // Keep the version with more English content.
  const byNumber = new Map<number, RawArticle[]>();
  for (const article of allArticles) {
    const existing = byNumber.get(article.number) ?? [];
    existing.push(article);
    byNumber.set(article.number, existing);
  }

  const dedupedArticles: RawArticle[] = [];
  for (const [, versions] of byNumber) {
    if (versions.length === 1) {
      dedupedArticles.push(versions[0]);
      continue;
    }
    // Pick the version with more English text
    let bestVersion = versions[0];
    let bestEnglishScore = 0;
    for (const v of versions) {
      const fullText = v.title + ' ' + v.content.join(' ');
      const englishWords = (fullText.match(/[A-Za-z]{3,}/g) || []).length;
      if (englishWords > bestEnglishScore) {
        bestEnglishScore = englishWords;
        bestVersion = v;
      }
    }
    dedupedArticles.push(bestVersion);
  }

  // Sort by article number
  dedupedArticles.sort((a, b) => a.number - b.number);
  return dedupedArticles;
}

/**
 * Extract definitions from definition articles.
 * Definition articles typically have numbered terms with "means" or "shall mean" patterns.
 */
function extractDefinitions(articles: RawArticle[], docId: string): ParsedDefinition[] {
  const definitions: ParsedDefinition[] = [];

  // Find the definitions article (usually article 2, titled "Definitions" or "Interpretation")
  const defArticle = articles.find(a =>
    /definition|interpretation/i.test(a.title) ||
    (a.number === 2 && a.content.some(l => /means|shall mean/i.test(l)))
  );

  if (!defArticle) return definitions;

  const fullText = defArticle.content.join('\n');

  // Pattern: term "means" definition, or numbered definitions like 1/ "term" means...
  const defPatterns = [
    // "term" means definition
    /[""]([^""]+)[""]\s+(?:means?|shall mean|refers? to)\s+(.*?)(?=\n\s*\d+\/|\n\s*[""]|$)/gis,
    // 1/ "term" means definition
    /\d+\/\s*[""]([^""]+)[""]\s+(?:means?|shall mean|refers? to)\s+(.*?)(?=\n\s*\d+\/|\n\s*$)/gis,
  ];

  for (const pattern of defPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const term = match[1].trim();
      const def = match[2].replace(/\s+/g, ' ').trim().replace(/;$/, '.');
      if (term.length > 1 && def.length > 5) {
        definitions.push({
          term,
          definition: def,
          source_provision: `Article ${defArticle.number}`,
        });
      }
    }
  }

  return definitions;
}

/* ---------- Main parser function ---------- */

/**
 * Parse extracted PDF text into a structured act with provisions and definitions.
 * Called by the ingestion pipeline after PDF download and text extraction.
 */
export function parsePdfText(text: string, act: ActIndexEntry): ParsedAct {
  const cleaned = cleanPdfText(text);
  const allLines = cleaned.split('\n');

  // Determine if bilingual and extract English if so
  const bilingual = isBilingual(allLines);
  const lines = bilingual ? extractEnglishContent(allLines) : allLines;

  // Parse articles
  const rawArticles = parseArticles(lines);

  // Convert to provisions
  const provisions: ParsedProvision[] = [];
  for (const article of rawArticles) {
    const contentText = article.content
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Skip articles with no meaningful content
    if (contentText.length < 5) continue;

    const provRef = `Article ${article.number}`;
    const section = article.number.toString();
    const chapter = [article.part, article.chapter].filter(Boolean).join(' / ') || undefined;

    provisions.push({
      provision_ref: provRef,
      chapter,
      section,
      title: article.title || `Article ${article.number}`,
      content: contentText,
    });
  }

  // Extract definitions
  const definitions = extractDefinitions(rawArticles, act.id);

  return {
    id: act.id,
    type: 'statute',
    title: act.title,
    title_en: act.titleEn,
    short_name: act.shortName,
    status: act.status,
    issued_date: act.issuedDate,
    in_force_date: act.inForceDate,
    url: act.url,
    description: bilingual ? 'Bilingual (Amharic/English) - English text extracted' : 'Amharic text (no English translation available)',
    provisions,
    definitions,
  };
}

// Legacy export for compatibility with the stub interface
export function parseHtml(html: string, act: ActIndexEntry): ParsedAct {
  // This function is no longer used -- PDFs are the primary source.
  // But we keep it for interface compatibility.
  return parsePdfText(html, act);
}

// Re-export parsePdfText as the primary parser
export function parseDjiboutiLawHtml(html: string, act: ActIndexEntry): ParsedAct {
  return parsePdfText(html, act);
}
