import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import { isHeic, MAX_PHOTO_BYTES, MAX_PHOTOS, photoMime, photoPath, validatePhotos } from './photos'

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
  it('rejects image types outside the whitelist', () => {
    expect(validatePhotos([file('a.bmp', 'image/bmp')])).toBe(he.tickets.errors.notImage('a.bmp'))
  })
  it('accepts a HEIC photo the system gave no type (Windows, some Android pickers), by its extension', () => {
    expect(validatePhotos([file('IMG_2.HEIC', ''), file('b.heif', 'application/octet-stream')])).toBeNull()
    expect(validatePhotos([file('evil.exe', '')])).toBe(he.tickets.errors.notImage('evil.exe'))
    expect(validatePhotos([file('noext', '')])).toBe(he.tickets.errors.notImage('noext'))
  })
  it('rejects files over 5 MB', () => {
    expect(validatePhotos([file('big.jpg', 'image/jpeg', MAX_PHOTO_BYTES + 1)])).toBe(he.tickets.errors.tooBig('big.jpg'))
  })
})

describe('photoPath', () => {
  it('builds <ticket_id>/<uuid>.<ext> from the mimetype, not the file name', () => {
    expect(photoPath('t1', file('../../evil.exe', 'image/jpeg'), 'u1')).toBe('t1/u1.jpg')
    expect(photoPath('t1', file('photo', 'image/png'), 'u1')).toBe('t1/u1.png')
    expect(photoPath('t1', file('IMG_1.HEIC', 'image/heic'), 'u1')).toBe('t1/u1.heic')
    expect(photoPath('t1', file('IMG_2.HEIC', ''), 'u1')).toBe('t1/u1.heic')
    expect(photoMime(file('IMG_2.HEIC', ''))).toBe('image/heic')
    expect(photoMime(file('a.jpeg', ''))).toBe('image/jpeg')
    expect(photoMime(file('a.svg', 'image/svg+xml'))).toBeNull()
  })
})

describe('isHeic', () => {
  it('detects HEIC/HEIF paths', () => {
    expect(isHeic('t/u.heic')).toBe(true)
    expect(isHeic('t/u.heif')).toBe(true)
    expect(isHeic('t/u.jpg')).toBe(false)
  })
})
