# Djiboutian Law MCP Server

**The Djibouti Law alternative for the AI age.**

[![npm version](https://badge.fury.io/js/%40ansvar/djiboutian-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/djiboutian-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/Djibouti-law-mcp?style=social)](https://github.com/Ansvar-Systems/Djibouti-law-mcp)
[![CI](https://github.com/Ansvar-Systems/Djibouti-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/Djibouti-law-mcp/actions/workflows/ci.yml)
[![Database](https://img.shields.io/badge/database-pre--built-green)]()
[![Provisions](https://img.shields.io/badge/provisions-21%2C559-blue)]()

Query **494 Djiboutian Acts** -- from the Data Protection Act and Computer Misuse and Cybercrimes Act to the Companies Act, Constitution of Djibouti, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing Djiboutian legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

Djiboutian legal research is scattered across Djibouti Law Reports, the Djibouti Gazette, and various government portals. Whether you're:
- A **lawyer** validating citations in a brief or contract under Djiboutian law
- A **compliance officer** checking if the Data Protection Act 2019 provisions apply to your processing activities
- A **legal tech developer** building tools on Djiboutian legislation
- A **researcher** tracing legislative history from colonial-era statutes to the 2010 Constitution

...you shouldn't need dozens of browser tabs and manual PDF cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes Djiboutian law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://djiboutian-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add djiboutian-law --transport http https://djiboutian-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "djiboutian-law": {
      "type": "url",
      "url": "https://djiboutian-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "djiboutian-law": {
      "type": "http",
      "url": "https://djiboutian-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/djiboutian-law-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "djiboutian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/djiboutian-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "djiboutian-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/djiboutian-law-mcp"]
    }
  }
}
```

---

## Example Queries

Once connected, just ask naturally:

- *"What does the Data Protection Act 2019 say about consent?"*
- *"Is the Companies Act 2015 still in force?"*
- *"Find provisions about cybersecurity in the Computer Misuse and Cybercrimes Act"*
- *"What does the Constitution of Djibouti say about the right to privacy?"*
- *"Search for data breach notification requirements in Djiboutian law"*
- *"What are the obligations under the National Payment Systems Act?"*
- *"Validate this legal citation"*
- *"Build a legal stance on personal data processing in Djibouti"*

---

## Key Legislation Covered

| Act | Year | Significance |
|-----|------|-------------|
| **Data Protection Act** | 2019 | Comprehensive data protection law modeled on EU GDPR; established the Office of the Data Protection Commissioner (ODPC) |
| **Computer Misuse and Cybercrimes Act** | 2018 | Comprehensive cybercrime legislation (note: Sections 22, 23, 24, 27, and 53 were partially suspended by the High Court pending constitutional review) |
| **Djibouti Information and Communications Act** | 1998 (amended) | Regulates telecommunications and ICT sector; establishes the Communications Authority of Djibouti |
| **Companies Act** | 2015 | Modern company law framework replacing the Companies Act (Cap 486) |
| **Consumer Protection Act** | 2012 | Consumer rights and fair trade practices |
| **Access to Information Act** | 2016 | Right to access government-held information |
| **National Payment Systems Act** | 2011 | Regulation of payment systems including mobile money (M-Pesa) |
| **Constitution of Djibouti** | 2010 | Supreme law; Article 31 guarantees the right to privacy |

---

## Deployment Tier

**SMALL** -- Single tier, bundled SQLite database shipped with the npm package.

**Estimated database size:** ~80-150 MB (full corpus of Djiboutian federal legislation)

---

## Available Tools (13)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `search_legislation` | FTS5 full-text search across all provisions with BM25 ranking |
| `get_provision` | Retrieve specific provision by statute + chapter/section |
| `check_currency` | Check if statute is in force, amended, or repealed |
| `validate_citation` | Validate citation against database (zero-hallucination check) |
| `build_legal_stance` | Aggregate citations from statutes for a legal topic |
| `format_citation` | Format citations per Djiboutian conventions (full/short/pinpoint) |
| `list_sources` | List all available statutes with metadata |
| `about` | Server info, capabilities, and coverage summary |

### EU/International Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `get_eu_basis` | Get EU directives/regulations for Djiboutian statute |
| `get_djiboutian_implementations` | Find Djiboutian laws implementing EU act |
| `search_eu_implementations` | Search EU documents with Djiboutian implementation counts |
| `get_provision_eu_basis` | Get EU law references for specific provision |
| `validate_eu_compliance` | Check implementation status of EU directives |

---

## Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from official Djiboutian government sources
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Provision retrieval gives exact text by statute identifier + chapter/section
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
Official Sources --> Parse --> SQLite --> FTS5 snippet() --> MCP response
                     ^                       ^
              Provision parser         Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search official databases by statute number | Search by plain language |
| Navigate multi-chapter statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `build_legal_stance` aggregates across sources |
| "Is this statute still in force?" --> check manually | `check_currency` tool --> answer in seconds |
| Find EU basis --> dig through EUR-Lex | `get_eu_basis` --> linked EU directives instantly |
| No API, no integration | MCP protocol --> AI-native |

---

## Data Sources & Freshness

All content is sourced from authoritative Djiboutian legal databases:

- **[Djibouti Law Reports](https://djiboutianlaw.org)** -- Official Djiboutian government legal database

**Verified data only** -- every citation is validated against official sources. Zero LLM-generated content.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official Djiboutian government publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is limited** -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **EU cross-references** are extracted from statute text, not EUR-Lex full text

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [SECURITY.md](SECURITY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment.

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

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### [@ansvar/us-regulations-mcp](https://github.com/Ansvar-Systems/US_Compliance_MCP)
**Query US federal and state compliance laws** -- HIPAA, CCPA, SOX, GLBA, FERPA, and more. `npx @ansvar/us-regulations-mcp`

### [@ansvar/security-controls-mcp](https://github.com/Ansvar-Systems/security-controls-mcp)
**Query 261 security frameworks** -- ISO 27001, NIST CSF, SOC 2, CIS Controls, SCF, and more. `npx @ansvar/security-controls-mcp`

### [@ansvar/automotive-cybersecurity-mcp](https://github.com/Ansvar-Systems/Automotive-MCP)
**Query UNECE R155/R156 and ISO 21434** -- Automotive cybersecurity compliance. `npx @ansvar/automotive-cybersecurity-mcp`

**30+ national law MCPs** covering Australia, Brazil, Canada, China, Denmark, Finland, France, Germany, Ghana, Iceland, India, Ireland, Israel, Italy, Japan, Djibouti, Netherlands, Nigeria, Norway, Singapore, Slovenia, South Korea, Sweden, Switzerland, Thailand, UAE, UK, and more.

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Court case law expansion
- EU cross-reference improvements
- Historical statute versions and amendment tracking
- Additional statutory instruments and regulations

---

## Roadmap

- [x] Core statute database with FTS5 search
- [x] EU/international law cross-references
- [x] Vercel Streamable HTTP deployment
- [x] npm package publication
- [ ] Court case law expansion
- [ ] Historical statute versions (amendment tracking)
- [ ] Preparatory works / explanatory memoranda
- [ ] Lower court and tribunal decisions

---

## Citation

If you use this MCP server in academic research:

```bibtex
@software{djiboutian_law_mcp_2025,
  author = {Ansvar Systems AB},
  title = {Djiboutian Law MCP Server: AI-Powered Legal Research Tool},
  year = {2025},
  url = {https://github.com/Ansvar-Systems/Djibouti-law-mcp},
  note = {Djiboutian legal database with full-text search and EU cross-references}
}
```

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Legislation:** Djiboutian Government (public domain)
- **EU Metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the global market. This MCP server started as our internal reference tool -- turns out everyone building compliance tools has the same research frustrations.

So we're open-sourcing it.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
