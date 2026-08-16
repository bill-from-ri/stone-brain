import { DocumentSearch } from './DocumentSearch'

type Props = {
  /**
   * Only screens that are *about* something name themselves. Home and the
   * Library are the app itself, and a header repeating the nav rail's selection
   * is noise; the search field starts the row instead.
   */
  title?: string
  /** Settings is the one screen with nothing to search. */
  search?: boolean
  /** Right-hand controls — the Library supplies its sync state and button here. */
  actions?: React.ReactNode
}

/** Ported from the prototype's header, lines 90-100. */
export function AppHeader({ title, search = true, actions }: Props) {
  return (
    <header className="sb-header">
      {title && <div className="sb-header-title">{title}</div>}
      {search ? <DocumentSearch /> : <div className="sb-header-spacer" />}
      {actions}
    </header>
  )
}
