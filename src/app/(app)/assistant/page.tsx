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
        phase={4}
        title="Writing assistant"
        body="Phase 4 adds a chat assistant grounded in the claim graph, able to cite documents and draft Markdown you can copy back to Drive yourself."
      />
    </>
  )
}
