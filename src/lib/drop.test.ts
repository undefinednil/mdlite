import assert from 'node:assert/strict'
import test from 'node:test'
import { droppedFileAction } from './drop'

test('an empty drop does nothing', () => {
  assert.equal(droppedFileAction([], true), null)
  assert.equal(droppedFileAction([], false), null)
})

test('edit mode uploads images and videos', () => {
  assert.deepEqual(droppedFileAction(['/tmp/photo.png'], true), {
    kind: 'media',
    paths: ['/tmp/photo.png'],
  })
  assert.deepEqual(droppedFileAction(['/tmp/clip.mp4'], true), {
    kind: 'media',
    paths: ['/tmp/clip.mp4'],
  })
  assert.deepEqual(droppedFileAction(['/tmp/note.md', '/tmp/photo.png'], true), {
    kind: 'media',
    paths: ['/tmp/photo.png'],
  })
})

test('other drops open the first file as a temporary file', () => {
  assert.deepEqual(droppedFileAction(['/tmp/note.md'], true), {
    kind: 'scratch',
    path: '/tmp/note.md',
  })
  assert.deepEqual(droppedFileAction(['/tmp/photo.png'], false), {
    kind: 'scratch',
    path: '/tmp/photo.png',
  })
  assert.deepEqual(droppedFileAction(['/tmp/a.md', '/tmp/b.md'], false), {
    kind: 'scratch',
    path: '/tmp/a.md',
  })
})
