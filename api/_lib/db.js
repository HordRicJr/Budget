import { neon } from '@neondatabase/serverless';

let client;
let testClient;

export function getSql() {
  if (testClient) return testClient;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL n’est pas configurée.');
  }

  client ??= neon(process.env.DATABASE_URL);
  return client;
}

export function setSqlForTests(sql) {
  testClient = sql;
}
