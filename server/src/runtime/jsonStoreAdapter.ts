export interface VersionedJsonValue {
  value: string
  version: number
}

export interface JsonStoreAdapter {
  read(fileName: string): Promise<VersionedJsonValue | null>
  write(fileName: string, value: string): Promise<void>
  writeIfVersion(fileName: string, value: string, expectedVersion: number | null): Promise<boolean>
}

let activeAdapter: JsonStoreAdapter | null = null

export function configureJsonStoreAdapter(adapter: JsonStoreAdapter | null): void {
  activeAdapter = adapter
}

export function getJsonStoreAdapter(): JsonStoreAdapter | null {
  return activeAdapter
}
