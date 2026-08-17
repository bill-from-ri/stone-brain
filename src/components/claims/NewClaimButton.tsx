'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { Route } from 'next'

/** Opens the editor in the right pane, via the URL so it survives a reload. */
export function NewClaimButton({
  composing,
  disabled,
}: {
  composing: boolean
  disabled: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const toggle = () => {
    const next = new URLSearchParams(params)
    if (composing) {
      next.delete('new')
    } else {
      next.set('new', '1')
      next.delete('claim')
    }
    router.replace(`${pathname}?${next}` as Route, { scroll: false })
  }

  return (
    <button
      type="button"
      className={`btn ${composing ? 'btn-secondary' : 'btn-primary'} sb-btn-sm`}
      onClick={toggle}
      disabled={disabled}
      title={disabled ? 'Add an entity first' : undefined}
    >
      <i className={`ph-bold ${composing ? 'ph-x' : 'ph-plus'}`} />
      {composing ? 'Cancel' : 'New claim'}
    </button>
  )
}
