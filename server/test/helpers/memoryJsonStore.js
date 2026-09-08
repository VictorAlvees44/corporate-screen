import { configureJsonStoreAdapter } from '../../dist/runtime/jsonStoreAdapter.js'

export function useMemoryJsonStore() {
  const records = new Map()
  configureJsonStoreAdapter({
    async read(name) { return records.get(name) ?? null },
    async write(name, value) { records.set(name, { value, version: (records.get(name)?.version ?? 0) + 1 }) },
    async writeIfVersion(name, value, expected) {
      if ((records.get(name)?.version ?? null) !== expected) return false
      records.set(name, { value, version: (expected ?? 0) + 1 })
      return true
    },
  })
  return records
}
