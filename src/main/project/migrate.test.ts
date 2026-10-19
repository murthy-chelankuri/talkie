import { describe, expect, it } from 'vitest'
import { migrateProjectMetadata, UnsupportedSchemaVersionError } from './migrate'

describe('migrateProjectMetadata', () => {
  it('passes through metadata already at the current schema version', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z', schemaVersion: 2 }

    expect(migrateProjectMetadata(raw)).toEqual(raw)
  })

  it('brings a project from before relative media paths up to version 2', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z', schemaVersion: 1 }

    expect(migrateProjectMetadata(raw).schemaVersion).toBe(2)
  })

  it('throws UnsupportedSchemaVersionError for a schema version newer than this app supports', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z', schemaVersion: 99 }

    expect(() => migrateProjectMetadata(raw)).toThrow(UnsupportedSchemaVersionError)
  })

  it('throws a clear error when a required upgrade path is missing', () => {
    const raw = { id: 'abc123', name: 'Checkout Flow', createdAt: '2026-09-06T00:00:00.000Z' }

    expect(() => migrateProjectMetadata(raw)).toThrow('No migration registered from schema v0')
  })
})
