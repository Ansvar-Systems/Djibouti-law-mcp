#!/usr/bin/env node

/**
 * Djibouti Law MCP Server — stdio entry point.
 *
 * Provides Djiboutian legislation search via Model Context Protocol.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from '@ansvar/mcp-sqlite';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { readFileSync, existsSync, copyFileSync, statfsSync } from 'fs';

import { registerTools, type AboutContext } from './tools/registry.js';
import { detectCapabilities, readDbMetadata } from './capabilities.js';
import {
  DB_ENV_VAR,
  SERVER_NAME,
  SERVER_VERSION,
} from './constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveDbPath(): string {
  if (process.env[DB_ENV_VAR]) {
    return process.env[DB_ENV_VAR];
  }
  return join(__dirname, '..', 'data', 'database.db');
}

// /tmp must be a real tmpfs — overlay2's writable layer triggers the WASM SQLite read bug.
// See docs/known-issues/wasm-sqlite-overlay-filesystem.md.
function ensureReadableDb(srcPath: string): string {
  const st = statfsSync('/tmp');
  const TMPFS_MAGIC = 0x01021994;
  if (Number(st.type) !== TMPFS_MAGIC) {
    throw new Error(
      `/tmp is not tmpfs (filesystem type 0x${Number(st.type).toString(16)}). ` +
      `WASM SQLite (@ansvar/mcp-sqlite) cannot read overlay2-backed files, and without a tmpfs mount /tmp sits on the container's writable layer. ` +
      `Start the container with 'docker run --tmpfs /tmp ...' or deploy via deployment/public-mcp/docker-compose.law.yml (x-law-defaults sets tmpfs: /tmp). ` +
      `See docs/known-issues/wasm-sqlite-overlay-filesystem.md.`,
    );
  }
  const tmpPath = join('/tmp', basename(srcPath));
  if (!existsSync(tmpPath)) {
    copyFileSync(srcPath, tmpPath);
  }
  return tmpPath;
}

let db: InstanceType<typeof Database> | null = null;

function getDb(): InstanceType<typeof Database> {
  if (!db) {
    const dbPath = ensureReadableDb(resolveDbPath());
    db = new Database(dbPath, { readonly: true });
    db.pragma('foreign_keys = ON');

    const caps = detectCapabilities(db);
    const meta = readDbMetadata(db);
    console.error(`[${SERVER_NAME}] DB opened: tier=${meta.tier}, caps=[${[...caps].join(',')}]`);
  }
  return db;
}

function computeAboutContext(): AboutContext {
  const dbPath = resolveDbPath();
  let fingerprint = 'unknown';
  let dbBuilt = 'unknown';

  try {
    const buf = readFileSync(dbPath);
    fingerprint = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch {
    // DB might not exist in dev
  }

  try {
    const database = getDb();
    const row = database.prepare("SELECT value FROM db_metadata WHERE key = 'built_at'").get() as { value: string } | undefined;
    if (row) dbBuilt = row.value;
  } catch {
    // Ignore
  }

  return { version: SERVER_VERSION, fingerprint, dbBuilt };
}

async function main() {
  const database = getDb();
  const aboutContext = computeAboutContext();

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  registerTools(server, database, aboutContext);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] Server running on stdio`);

  const cleanup = () => {
    if (db) {
      db.close();
      db = null;
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, err);
  process.exit(1);
});
