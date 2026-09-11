import { describe, expect, it } from 'vitest'
import { linearMenuFocus, moveGridFocus } from './battleSelection'

describe('battle selection model', () => {
  it('uses the same wrapping grid navigation for every input source', () => {
    expect(moveGridFocus(0, 'left', 4)).toBe(3)
    expect(moveGridFocus(3, 'right', 4)).toBe(0)
    expect(moveGridFocus(1, 'down', 4)).toBe(3)
    expect(moveGridFocus(3, 'up', 4)).toBe(1)
  })

  it('does not move focus for confirm and back', () => {
    expect(moveGridFocus(2, 'confirm', 4)).toBe(2)
    expect(moveGridFocus(2, 'back', 4)).toBe(2)
  })

  it('wraps the compact command rail in either direction', () => {
    expect(linearMenuFocus(0, 'up', 2)).toBe(1)
    expect(linearMenuFocus(1, 'down', 2)).toBe(0)
    expect(linearMenuFocus(0, 'right', 2)).toBe(1)
  })
})
