/**
 * list_sources — Return provenance metadata for all data sources.
 */

import type Database from '@ansvar/mcp-sqlite';
import { readDbMetadata } from '../capabilities.js';
import { generateResponseMetadata, type ToolResponse } from '../utils/metadata.js';

export interface SourceInfo {
  name: string;
  authority: string;
  url: string;
  license: string;
  coverage: string;
  languages: string[];
}

export interface ListSourcesResult {
  sources: SourceInfo[];
  database: {
    tier: string;
    schema_version: string;
    built_at?: string;
    document_count: number;
    provision_count: number;
  };
}

function safeCount(db: InstanceType<typeof Database>, sql: string): number {
  try {
    const row = db.prepare(sql).get() as { count: number } | undefined;
    return row ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

export async function listSources(
  db: InstanceType<typeof Database>,
): Promise<ToolResponse<ListSourcesResult>> {
  const meta = readDbMetadata(db);

  return {
    results: {
      sources: [
        {
          name: 'Journal Officiel de la République de Djibouti (JORD)',
          authority: 'journalofficiel.dj (eJO — Journal Officiel de Djibouti)',
          url: 'https://www.journalofficiel.dj',
          license: 'Public record (Journal Officiel)',
          coverage:
            'Lois, lois organiques, lois de finances, ordonnances, décrets, arrêtés, ' +
            'décisions, circulaires, délibérations, avis, proclamations et conventions ' +
            'publiés au Journal Officiel de la République de Djibouti depuis son numérisation. ' +
            'Couvre notamment le droit constitutionnel, le droit civil et pénal, le droit commercial, ' +
            'la fiscalité, le droit du travail, l’environnement, les télécommunications et le droit bancaire.',
          languages: ['fr'],
        },
      ],
      database: {
        tier: meta.tier,
        schema_version: meta.schema_version,
        built_at: meta.built_at,
        document_count: safeCount(db, 'SELECT COUNT(*) as count FROM legal_documents'),
        provision_count: safeCount(db, 'SELECT COUNT(*) as count FROM legal_provisions'),
      },
    },
    _metadata: generateResponseMetadata(db),
  };
}
