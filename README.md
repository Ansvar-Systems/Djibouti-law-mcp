# Djibouti Law MCP Server

**The Journal Officiel de la République de Djibouti, for the AI age.**

[![npm version](https://badge.fury.io/js/%40ansvar%2Fdjibouti-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/djibouti-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Djibouti-law-mcp?style=social)](https://github.com/Ansvar-Systems/Djibouti-law-mcp)

Query Djiboutian legislation directly from Claude, Cursor, or any MCP-compatible client. Lois organiques, lois, lois de finances, ordonnances, proclamations, and the constitutional texts — every title sourced from the **Journal Officiel de la République de Djibouti (JORD)**.

Built by [Ansvar Systems](https://ansvar.eu) — Stockholm, Sweden.

---

## Why This Exists

Djiboutian legal research is fragmented across the JORD archive, government ministry sites, and occasional PDF mirrors. Whether you are:

- A **lawyer** validating citations in a dossier under Djiboutian law
- A **compliance officer** checking obligations under a specific loi or décret
- A **legal-tech developer** building tools over Djiboutian legislation
- A **researcher** following the legislative history of the Code du Travail, the Code Pénal, or the Constitution

…you should not need a dozen browser tabs to find one article. Ask Claude. Get the exact provision. With citation metadata and the JORD link.

This MCP makes Djiboutian law **searchable, cross-referenceable, and AI-readable** — all in French, the sole legal language of the Republic.

---

## Quick Start

### Use Remotely (No Install Needed)

Connect directly to the hosted version — zero dependencies.

**Endpoint:** `https://djibouti-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add djibouti-law --transport http https://djibouti-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "djibouti-law": {
      "type": "url",
      "url": "https://djibouti-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** — add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "djibouti-law": {
      "type": "http",
      "url": "https://djibouti-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/djibouti-law-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "djibouti-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/djibouti-law-mcp"]
    }
  }
}
```

**Cursor / VS Code** — add to `.cursor/mcp.json` or `mcp.json`:

```json
{
  "mcp.servers": {
    "djibouti-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/djibouti-law-mcp"]
    }
  }
}
```

---

## Example Queries

Once connected, just ask naturally (in French or English):

- *"Que dit la Constitution sur le Conseil Constitutionnel ?"*
- *"Search for provisions about marchés publics in Djiboutian law."*
- *"Lookup the Loi n°192/AN/25/9ème L."*
- *"What does the Code du Travail say about congés payés ?"*
- *"Validate this citation: Article 27, Constitution de la République de Djibouti."*
- *"Build a legal stance on the protection des données personnelles in Djibouti."*

---

## Coverage

The corpus is assembled from the **Journal Officiel de la République de Djibouti (JORD)** via its public WordPress REST API at `https://www.journalofficiel.dj/wp-json/wp/v2/`.

| Nature | Included in default build |
|--------|---------------------------|
| Loi | yes |
| Loi organique | yes |
| Loi de finances | yes |
| Ordonnance | yes |
| Proclamation | yes |
| Décret, arrêté, décision, délibération, circulaire, avis | on demand via `--natures` |

See [COVERAGE.md](COVERAGE.md) for the generated per-act index.

---

## Available Tools

### Core legal research

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across every article, with BM25 ranking |
| `get_provision` | Retrieve a specific article by act + article number |
| `check_currency` | Check whether an act or provision is in force, amended, or repealed |
| `validate_citation` | Validate a citation against the database (zero-hallucination check) |
| `build_legal_stance` | Aggregate citations across acts for a legal topic |
| `format_citation` | Format a citation per French legal drafting conventions |
| `list_sources` | List provenance metadata for every data source |
| `about` | Server info, capabilities, and coverage summary |

### EU / international cross-reference (capability-gated)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | EU directives / regulations aligned with a Djiboutian act |
| `get_djiboutian_implementations` | Djiboutian acts aligning with a given EU instrument |
| `search_eu_implementations` | Search EU documents with Djiboutian alignment counts |
| `get_provision_eu_basis` | EU references for a specific provision |
| `validate_eu_compliance` | Check alignment status of an act or provision |

EU cross-reference tools only appear when the optional `eu_documents` / `eu_references` tables are present in the database.

---

## Why This Works

**Verbatim source text — no LLM processing.**
- Every article is ingested directly from the JORD WordPress REST API
- Provisions are returned **unchanged** from SQLite FTS5 rows
- Zero summarisation or paraphrasing — the database stores the text, not an interpretation

**Smart context management.**
- Search returns ranked provisions with BM25 scoring (safe for model context windows)
- Provision retrieval gives exact text by act identifier + article reference
- Cross-references help navigate without loading a whole code into context

**Technical architecture.**

```
JORD REST API --> Parse (HTML → articles) --> SQLite + FTS5 --> MCP response
                                                                   ^
                                                         Verbatim query, nothing rewritten
```

---

## Data Source and Freshness

All content is sourced from the **Journal Officiel de la République de Djibouti (JORD)** — the official gazette of the Republic, published by the Imprimerie Nationale. Records include:

- Full text of each article (French, UTF-8)
- JORD reference (e.g. `n°192/AN/25/9ème L`)
- Parent JORD issue (e.g. `n° 06 du 21/04/2026`)
- Publishing institution (Présidence, Ministère, Conseil Constitutionnel, etc.)
- Date of issue

`scripts/census.ts` enumerates the JORD via the REST API; `scripts/ingest.ts` fetches each record and extracts its TITRE / CHAPITRE / SECTION / Article structure. `scripts/build-db.ts` assembles the SQLite database. `scripts/check-updates.ts` flags stale data or missing records.

---

## Security

This project uses automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **GitHub Advanced Security (CodeQL)** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Secret scanning** | Detects leaked credentials across the repository | Continuous |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal advice

> **THIS TOOL IS NOT LEGAL ADVICE.**
>
> Articles are sourced from the Journal Officiel de la République de Djibouti. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Case law coverage is out of scope** — do not rely on this for jurisprudence
> - **Verify critical citations** against the JORD directly before court filings
> - **EU cross-references**, where present, are extracted metadata, not full EUR-Lex text

Before using professionally, read: [DISCLAIMER.md](DISCLAIMER.md) | [SECURITY.md](SECURITY.md).

### Client confidentiality

Remote queries go through the Claude API. For privileged matters, run the stdio npm package locally and the server will never send your queries to a third party.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/Djibouti-law-mcp
cd Djibouti-law-mcp
npm install
npm run build
npm test
```

### Rebuild the corpus from scratch

```bash
npm run census       # Enumerate JORD via REST API -> data/census.json
npm run ingest       # Fetch + parse every ingestable act -> data/seed/*.json
npm run build:db     # Assemble data/database.db from seeds
```

### Test with MCP Inspector

```bash
npx @anthropic/mcp-inspector node dist/src/index.js
```

---

## Related Projects — Ansvar Open Law

This MCP is part of the **Ansvar Open Law** family — per-jurisdiction MCPs that share a common tool surface:

- [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP) — GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS
- [@ansvar/us-regulations-mcp](https://github.com/Ansvar-Systems/US_Compliance_MCP) — HIPAA, CCPA, SOX, GLBA, FERPA
- [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp) — ISO 27001, NIST CSF, SOC 2, CIS Controls

National law MCPs also cover Cameroon, Ethiopia, France, Germany, Italy, Kenya, Morocco, Nigeria, Senegal, South Africa, the UK, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Coverage expansion across décrets and arrêtés
- Amendment tracking (`status: amended`) from explicit repeal / modification clauses
- JORD issue-level metadata enrichment
- Historical coverage back to the first numbered JORD issues

---

## Roadmap

- [x] Core corpus assembled from the JORD REST API
- [x] SQLite + FTS5 full-text search
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [ ] Décret / arrêté rolling coverage
- [ ] Amendment chain detection
- [ ] EU/international cross-reference enrichment

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{djibouti_law_mcp_2026,
  author = {Ansvar Systems AB},
  title  = {Djibouti Law MCP Server},
  year   = {2026},
  url    = {https://github.com/Ansvar-Systems/Djibouti-law-mcp},
  note   = {Djiboutian legal database sourced from the Journal Officiel de la République de Djibouti (JORD)}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE).

### Data licences

- **Statutes & regulations:** public record (Journal Officiel), reproduction permitted with source attribution
- **EU metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools. This MCP started as an internal reference and is open-sourced for the wider community.

**[ansvar.eu](https://ansvar.eu)** — Stockholm, Sweden.

<p align="center"><sub>Built with care in Stockholm, Sweden.</sub></p>
