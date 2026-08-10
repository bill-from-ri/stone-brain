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
        phase={3}
        title="Conflicts"
        body="Phase 3 detects claims that share a subject and relationship but disagree on the object, and gives you a way to adjudicate them."
      />
    </>
  )
}
