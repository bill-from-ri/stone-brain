import { AppHeader } from '@/components/shell/AppHeader'
import { StubScreen } from '@/components/stub/NotYetReal'
import { requireUser } from '@/lib/auth/guard'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await requireUser()
  return (
    <>
      <AppHeader />
      <StubScreen
        phase={2}
        title="Extracted claims"
        body="Phase 2 puts an LLM over each document to extract atomic claims about entities and their relationships, then lands them in a table you can edit. Nothing is extracted yet."
      />
    </>
  )
}
