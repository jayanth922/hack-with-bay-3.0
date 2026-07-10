import neo4j, { Driver, Session, QueryResult } from 'neo4j-driver';
import { config } from './config.js';

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
      { maxConnectionLifetime: 30 * 60 * 1000 }
    );
  }
  return driver;
}

/** Run a read/write Cypher query and return plain JS records. */
export async function run<T = Record<string, any>>(
  cypher: string,
  params: Record<string, any> = {}
): Promise<T[]> {
  const session: Session = getDriver().session({ database: config.neo4j.database });
  try {
    const res: QueryResult = await session.run(cypher, params);
    return res.records.map((r) => toPlain(r.toObject()) as T);
  } finally {
    await session.close();
  }
}

/** Neo4j returns Integer objects and Node/Relationship wrappers — flatten to plain JS. */
export function toPlain(value: any): any {
  if (value == null) return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    // Node or Relationship
    if ('properties' in value && ('labels' in value || 'type' in value)) {
      return { ...toPlain(value.properties), _id: value.identity?.toString?.() };
    }
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

export async function verifyConnectivity(): Promise<void> {
  await getDriver().verifyConnectivity();
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
