/**
 * Response metadata utilities for Djibouti Law MCP.
 */

import type Database from '@ansvar/mcp-sqlite';

export interface ResponseMetadata {
  data_source: string;
  jurisdiction: string;
  disclaimer: string;
  freshness?: string;
}

export interface ToolResponse<T> {
  results: T;
  _metadata: ResponseMetadata;
}

export function generateResponseMetadata(
  db: InstanceType<typeof Database>,
): ResponseMetadata {
  let freshness: string | undefined;
  try {
    const row = db.prepare(
      "SELECT value FROM db_metadata WHERE key = 'built_at'"
    ).get() as { value: string } | undefined;
    if (row) freshness = row.value;
  } catch {
    // Ignore
  }

  return {
    data_source:
      'Journal Officiel de la République de Djibouti (JORD) — journalofficiel.dj',
    jurisdiction: 'DJ',
    disclaimer:
      'This data is sourced from the Journal Officiel de la République de Djibouti (JORD). ' +
      'The authoritative version of each text is the one published in the JORD. ' +
      'Always verify with https://www.journalofficiel.dj before relying on this data in a legal context.',
    freshness,
  };
}
