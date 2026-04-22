/**
 * JORD HTML Parser — Journal Officiel de la République de Djibouti.
 *
 * Parses French-language legal texts fetched from the WordPress REST API
 * (post type `texte-juridique`). Each record exposes:
 *   - title.rendered     full title in French
 *   - content.rendered   HTML body with articles, considérants, operative block
 *   - acf.reference      legal reference (e.g. "03/2026/CC")
 *   - acf.visas          "VU La..." clauses (legal bases)
 *   - acf.signature      signing authority block
 *   - acf.comment        subtitle / purpose
 *
 * Structural markers recognised (French legal drafting conventions):
 *   - TITRE I, TITRE II, ...
 *   - CHAPITRE I, CHAPITRE II, ...
 *   - SECTION 1, SECTION 2, ...
 *   - Article premier, Article 1, Article 1er, Article 2, ...
 */

export interface JordTaxonomyTerm {
  id: number;
  slug: string;
  name: string;
}

export interface ParsedProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title?: string;
  content: string;
}

export interface ParsedAct {
  id: string;
  type: 'statute';
  title: string;
  short_name?: string;
  status: 'in_force' | 'amended' | 'repealed' | 'not_yet_in_force';
  reference?: string;
  issued_date: string;
  in_force_date?: string;
  url: string;
  description?: string;
  nature?: string;
  institution?: string;
  visas?: string;
  signature?: string;
  journal_issue_ids?: number[];
  provisions: ParsedProvision[];
}

/* ---------- HTML normalisation ---------- */

/** Named HTML entities we routinely see in JORD content (French letters + punctuation). */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // French lowercase accented
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  agrave: 'à',
  acirc: 'â',
  auml: 'ä',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ocirc: 'ô',
  ouml: 'ö',
  oelig: 'œ',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  uuml: 'ü',
  ccedil: 'ç',
  yuml: 'ÿ',
  // French uppercase accented
  Eacute: 'É',
  Egrave: 'È',
  Ecirc: 'Ê',
  Agrave: 'À',
  Acirc: 'Â',
  Icirc: 'Î',
  Ocirc: 'Ô',
  Ucirc: 'Û',
  OElig: 'Œ',
  Ccedil: 'Ç',
  // Punctuation
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  middot: '·',
  bull: '•',
  trade: '™',
  copy: '©',
  reg: '®',
  sect: '§',
  para: '¶',
  times: '×',
  divide: '÷',
};

/** Decode named and numeric HTML entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name]! : whole,
    );
}

/** Strip all HTML tags and collapse whitespace, preserving paragraph breaks. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return decodeEntities(
    html
      // Block tags get a newline so paragraphs and table rows separate
      .replace(/<\s*(?:br|\/p|\/div|\/h\d|\/li|\/tr)\s*\/?>/gi, '\n')
      // Table cells become spaces (keep words adjacent; empty cells disappear)
      .replace(/<\s*\/?(?:td|th)[^>]*>/gi, ' ')
      // Remove all remaining tags
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/* ---------- Article extraction ---------- */

const ARTICLE_RE =
  /^\s*Article\s+(premier|[0-9]+(?:\s*(?:er|bis|ter|quater))?(?:-[0-9]+)*)\s*[.:–—]?\s*(.*)$/i;
const TITRE_RE = /^\s*TITRE\s+([IVXLCDM]+|\d+)(?:\s*[–—\-:.])?\s*(.*)$/;
const CHAPITRE_RE = /^\s*CHAPITRE\s+([IVXLCDM]+|\d+)(?:\s*[–—\-:.])?\s*(.*)$/;
const SECTION_RE = /^\s*SECTION\s+([IVXLCDM]+|\d+)(?:\s*[–—\-:.])?\s*(.*)$/;

function normaliseArticleNumber(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  if (trimmed === 'premier' || /^1\s*er$/.test(trimmed)) return '1';
  return trimmed.replace(/\s+/g, '');
}

/** Parse a block of normalised French legal text into provisions. */
export function parseProvisions(text: string): ParsedProvision[] {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\n/);
  const provisions: ParsedProvision[] = [];

  let currentTitre: string | undefined;
  let currentChapitre: string | undefined;
  let currentSection: string | undefined;
  let openArticle: ParsedProvision | null = null;

  const flush = () => {
    if (openArticle) {
      openArticle.content = openArticle.content.trim();
      if (openArticle.content) provisions.push(openArticle);
      openArticle = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (openArticle) openArticle.content += '\n\n';
      continue;
    }

    const titreMatch = TITRE_RE.exec(line);
    if (titreMatch) {
      flush();
      currentTitre = `TITRE ${titreMatch[1]}${titreMatch[2] ? ' — ' + titreMatch[2].trim() : ''}`;
      currentChapitre = undefined;
      currentSection = undefined;
      continue;
    }

    const chapMatch = CHAPITRE_RE.exec(line);
    if (chapMatch) {
      flush();
      currentChapitre = `CHAPITRE ${chapMatch[1]}${chapMatch[2] ? ' — ' + chapMatch[2].trim() : ''}`;
      currentSection = undefined;
      continue;
    }

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      flush();
      currentSection = `SECTION ${sectionMatch[1]}${sectionMatch[2] ? ' — ' + sectionMatch[2].trim() : ''}`;
      continue;
    }

    const artMatch = ARTICLE_RE.exec(line);
    if (artMatch) {
      flush();
      const num = normaliseArticleNumber(artMatch[1]);
      const head = artMatch[2].trim();
      const chapterPath = [currentTitre, currentChapitre, currentSection]
        .filter(Boolean)
        .join(' > ');
      openArticle = {
        provision_ref: `art${num}`,
        section: num,
        title: `Article ${num}`,
        chapter: chapterPath || undefined,
        content: head,
      };
      continue;
    }

    if (openArticle) {
      openArticle.content += (openArticle.content ? '\n' : '') + line;
    }
  }

  flush();
  return provisions;
}

/* ---------- Slug helpers ---------- */

/** Build a short name from a long title. */
export function buildShortName(title: string, maxLen = 80): string {
  if (title.length <= maxLen) return title;
  const cut = title.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '…';
}

/** ASCII-safe slug from a French title (keeps ids reproducible). */
export function slugify(s: string, maxLen = 200): string {
  const base = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > maxLen ? base.slice(0, maxLen).replace(/-+$/g, '') : base;
}

/* ---------- Date normalisation ---------- */

/** Normalise a WordPress-style date (YYYY-MM-DDTHH:mm:ss) to YYYY-MM-DD. */
export function toIsoDate(s: string | undefined | null): string {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Parse compressed ACF date "YYYYMMDD" or standard "YYYY-MM-DD". */
export function parseAcfDate(s: string | undefined | null): string {
  if (!s) return '';
  const compressed = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compressed) return `${compressed[1]}-${compressed[2]}-${compressed[3]}`;
  return toIsoDate(s);
}
