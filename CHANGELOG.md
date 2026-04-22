# Changelog

## 0.1.0 (2026-04-22)

- Initial release.
- Corpus assembled from the Journal Officiel de la République de Djibouti
  (JORD, https://www.journalofficiel.dj/) via the public WordPress REST API.
- Default coverage: Lois, Lois organiques, Lois de finances, Ordonnances,
  Proclamations (2,747 acts enumerated in census).
- FTS5 full-text search, citation validation, currency check, EU-basis
  cross-references.
- Dual transport: stdio (npm) + Streamable HTTP (Vercel).
