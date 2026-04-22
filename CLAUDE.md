# Djibouti Law MCP Server — Developer Guide

## Git Workflow

- **Never commit directly to `main`.** Always create a feature branch and open a Pull Request.
- Branch protection requires: verified signatures, PR review, and status checks to pass.
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Project Overview

Djibouti Law MCP server providing search over Djiboutian legislation via the Model Context Protocol. Strategy A deployment (Vercel, bundled SQLite DB). Covers the Constitution, lois organiques, lois, ordonnances, décrets, and proclamations published in the Journal Officiel de la République de Djibouti (JORD).

## Architecture

- **Transport:** Dual-channel — stdio (npm package) + Streamable HTTP (Vercel serverless)
- **Database:** SQLite + FTS5 via `@ansvar/mcp-sqlite` (WASM-compatible, no WAL mode)
- **Entry points:** `src/index.ts` (stdio), `api/mcp.ts` (Vercel HTTP)
- **Tool registry:** `src/tools/registry.ts` — shared between both transports
- **Capability gating:** `src/capabilities.ts` — detects available DB tables at runtime

## Key Conventions

- All database queries use parameterised statements (never string interpolation)
- FTS5 queries go through `buildFtsQueryVariants()` with primary + fallback strategy
- User input is sanitised via `sanitizeFtsInput()` before FTS5 queries
- Every tool returns `ToolResponse<T>` with `results` + `_metadata` (freshness, disclaimer)
- Tool descriptions are written for LLM agents — explain WHEN and WHY to use each tool
- Capability-gated tools only appear in `tools/list` when their DB tables exist
- Djibouti uses "Article N" throughout (lois, décrets, arrêtés, Constitution)

## Testing

- Unit tests: `tests/` (vitest, in-memory SQLite fixtures)
- Contract tests: `__tests__/contract/golden.test.ts` with `fixtures/golden-tests.json`
- Nightly mode: `CONTRACT_MODE=nightly` enables network assertions
- Run: `npm test` (unit), `npm run test:contract` (golden), `npm run validate` (both)

## Database

- Schema defined inline in `scripts/build-db.ts`
- Journal mode: DELETE (not WAL — required for Vercel serverless)
- Runtime: copied to `/tmp/database.db` on Vercel cold start
- Metadata: `db_metadata` table stores tier, schema_version, built_at, builder, jurisdiction, source, licence

## Data Pipeline

1. `scripts/census.ts` → enumerates legal texts from the JORD WP REST API → `data/census.json`
2. `scripts/ingest.ts` → fetches each texte-juridique → parses HTML → `data/seed/{id}.json`
3. `scripts/build-db.ts` → seed JSON → SQLite database in `data/database.db`
4. `scripts/drift-detect.ts` → verifies upstream content has not changed

## Data Source

- **JORD** — Journal Officiel de la République de Djibouti, https://www.journalofficiel.dj
- **API:** WordPress REST API at `/wp-json/wp/v2/` (post types `journal-officiel` and `texte-juridique`)
- **Licence:** Public record (Journal Officiel)
- **Language:** French (the sole legal language of Djibouti)
- **Coverage:** Lois, lois organiques, lois de finances, ordonnances, proclamations — plus décrets, arrêtés, décisions, délibérations on request via `--natures`

## Djibouti-Specific Notes

- Djibouti follows a civil-law tradition inherited from French legal administration; all primary legal drafting is in French
- The Constitution de la République de Djibouti (15 septembre 1992, révisée en 2010 et 2025) is the supreme law
- Legislation is identified by a JORD reference of the form `n°N/AN/YY/Nème L` (loi), `n°YYYY-NNN/PR/MI` (décret), etc.
- Citations follow the French pattern: "Article N, Loi n°N/AN/YY" or "Art. N, Loi n°N/AN/YY"
- JORD issues are numbered per year (e.g., `n° 06 du 21/04/2026`) and linked to each texte-juridique via `acf.journal_officiel`

## Deployment

- Vercel Strategy A: DB bundled in `data/database.db`, included via `vercel.json` includeFiles
- npm package: `@ansvar/djibouti-law-mcp` with bin entry for stdio
