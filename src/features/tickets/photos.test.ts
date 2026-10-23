import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import { MAX_PHOTO_BYTES, MAX_PHOTOS, photoPath, validatePhotos } from './photos'

const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type })

describe('validatePhotos', () => {
  it('accepts up to 5 images under 5 MB', () => {
    expect(validatePhotos([file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')])).toBeNull()
  })
  it('rejects more than 5 photos', () => {
    const many = Array.from({ length: MAX_PHOTOS + 1 }, (_, i) => file(`${i}.jpg`, 'image/jpeg'))
    expect(validatePhotos(many)).toBe(he.tickets.errors.tooMany)
  })
  it('rejects non-images', () => {
    expect(validatePhotos([file('a.pdf', 'application/pdf')])).toBe(he.tickets.errors.notImage('a.pdf'))
  })
  it('rejects files over 5 MB', () => {
    expect(validatePhotos([file('big.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1)])).toBe(he.tickets.errors.tooBig('big.jpg'))
  })
})

describe('photoPath', () => {
  it('builds <ticket_id>/<uuid>.<ext> with a lowercase extension', () => {
    expect(photoPath('t1', file('IMG.JPG', 'image/jpeg'), 'u1')).toBe('t1/u1.jpg')
  })
  it('falls back to the mimetype when the name has no extension', () => {
    expect(photoPath('t1', file('photo', 'image/png'), 'u1')).toBe('t1/u1.png')
  })
})
