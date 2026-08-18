import { GlobalSearch } from './GlobalSearch'

type Props = {
  /** Settings is the one screen with nothing to search. */
  search?: boolean
}

/**
 * The one header every screen gets, and the only thing in it is search.
 *
 * No page title: the nav rail already says where you are, and a header
 * repeating it is noise. No per-page buttons either — a control belongs beside
 * the thing it acts on (the Library's sync button sits on the breadcrumb bar,
 * "New claim" beside the claim count), not in a strip that changes shape as you
 * move between screens.
 */
export function AppHeader({ search = true }: Props) {
  return (
    <header className="sb-header">
      {search ? <GlobalSearch /> : <div className="sb-header-spacer" />}
    </header>
  )
}
