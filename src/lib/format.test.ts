import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDate, formatDeletedAt, formatRelativeTime, formatSize } from './format'

test('formats a file size in binary units', () => {
  assert.equal(formatSize(0), '0 B')
  assert.equal(formatSize(1023), '1023 B')
  assert.equal(formatSize(1024), '1.0 KB')
  assert.equal(formatSize(1536), '1.5 KB')
  assert.equal(formatSize(1024 * 1024), '1.0 MB')
  assert.equal(formatSize(3 * 1024 * 1024), '3.0 MB')
})

test('shows the year only when a date is outside the current year', () => {
  const now = new Date(2026, 0, 15, 12, 0)
  const thisYear = new Date(2026, 10, 7, 3, 9).getTime()
  const otherYear = new Date(2025, 10, 7, 3, 9).getTime()

  assert.equal(formatDate(0, now), '—')
  assert.ok(formatDate(thisYear, now).includes('7'))
  assert.ok(!formatDate(thisYear, now).includes('2026'))
  assert.ok(formatDate(otherYear, now).includes('2025'))
})

test('formats a deleted time without a year and leaves a missing time empty', () => {
  const deletedAt = new Date(2026, 10, 7, 3, 9).getTime()

  assert.equal(formatDeletedAt(0), '')
  assert.ok(formatDeletedAt(deletedAt).includes('7'))
  assert.ok(!formatDeletedAt(deletedAt).includes('2026'))
})

test('formats a recent time relative to now', () => {
  const now = new Date(2026, 10, 7, 12, 0).getTime()

  assert.equal(formatRelativeTime(0, now), '')
  assert.equal(formatRelativeTime(now - 30_000, now), 'just now')
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5m ago')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), '3h ago')
  assert.equal(formatRelativeTime(now - 2 * 86_400_000, now), '2d ago')
  assert.ok(formatRelativeTime(now - 8 * 86_400_000, now).length > 0)
})
