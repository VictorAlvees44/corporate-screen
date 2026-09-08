import type { JsonStoreAdapter, VersionedJsonValue } from '../../server/src/runtime/jsonStoreAdapter'

export class D1JsonStoreAdapter implements JsonStoreAdapter {
  constructor(private readonly database: D1Database) {}

  async read(fileName: string): Promise<VersionedJsonValue | null> {
    const row = await this.database
      .prepare('SELECT value, version FROM json_store WHERE file_name = ?1')
      .bind(fileName)
      .first<{ value: string; version: number }>()

    return row ?? null
  }

  async write(fileName: string, value: string): Promise<void> {
    await this.database
      .prepare(`
        INSERT INTO json_store (file_name, value, version, updated_at)
        VALUES (?1, ?2, 1, datetime('now'))
        ON CONFLICT(file_name) DO UPDATE SET
          value = excluded.value,
          version = json_store.version + 1,
          updated_at = excluded.updated_at
      `)
      .bind(fileName, value)
      .run()
  }

  async writeIfVersion(fileName: string, value: string, expectedVersion: number | null): Promise<boolean> {
    const result = expectedVersion === null
      ? await this.database
          .prepare(`
            INSERT INTO json_store (file_name, value, version, updated_at)
            VALUES (?1, ?2, 1, datetime('now'))
            ON CONFLICT(file_name) DO NOTHING
          `)
          .bind(fileName, value)
          .run()
      : await this.database
          .prepare(`
            UPDATE json_store
            SET value = ?2, version = version + 1, updated_at = datetime('now')
            WHERE file_name = ?1 AND version = ?3
          `)
          .bind(fileName, value, expectedVersion)
          .run()

    return Number(result.meta.changes ?? 0) === 1
  }
}
