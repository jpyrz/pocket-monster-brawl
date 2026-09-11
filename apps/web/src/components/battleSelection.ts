import type { LogicalControl } from '@pmb/domain'

export function moveGridFocus(current: number, action: LogicalControl, itemCount: number): number {
  if (itemCount <= 0) return 0
  if (action === 'up' || action === 'down') return (current + 2) % itemCount
  if (action === 'left') return (current + itemCount - 1) % itemCount
  if (action === 'right') return (current + 1) % itemCount
  return current
}

export function linearMenuFocus(current: number, action: LogicalControl, itemCount: number): number {
  if (itemCount <= 0) return 0
  if (action === 'up' || action === 'left') return (current + itemCount - 1) % itemCount
  if (action === 'down' || action === 'right') return (current + 1) % itemCount
  return current
}
