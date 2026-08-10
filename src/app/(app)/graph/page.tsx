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
        title="Relationship graph"
        body="Once claims exist, this becomes the graph view over them — entities as nodes, claims as edges, filtered by era."
      />
    </>
  )
}
