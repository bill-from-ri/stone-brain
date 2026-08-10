import type { DriveFile } from './types'

/**
 * The single place in the codebase where "is this file inside the user's chosen
 * root folder?" is decided.
 *
 * This exists because `drive.readonly` grants read access to the user's ENTIRE
 * Drive (decisions §2). Confining Stone Brain to one folder is our own
 * application-level policy, not something OAuth enforces — which means a bug
 * here is a privacy incident, not a display glitch. Everything else in the sync
 * path is written to route through this class rather than reimplementing
 * containment checks at call sites.
 *
 * Dependencies are injected rather than imported so this is testable against a
 * fake Drive with no network and no module mocking.
 */

export type ScopeVerdict = 'in' | 'out'

/** Realistic Drive nesting is single digits; 20 is far beyond it. */
export const MAX_ANCESTRY_DEPTH = 20

export type ScopeResolverDeps = {
  rootId: string
  /** Folder ids already known to be inside the root, from our mirrored tree. */
  knownInScope: Iterable<string>
  /** Fetch one file's ancestry fields. Throws for unreadable/missing files. */
  getFile: (fileId: string) => Promise<DriveFile>
  /** Shared-drive id of the root, when it lives in one. */
  rootDriveId?: string | undefined
  onWarn?: ((message: string) => void) | undefined
}

export type ScopeNode = {
  id: string
  parents?: string[] | undefined
  driveId?: string | undefined
}

/**
 * Raised when containment could not be determined because Drive would not
 * answer. The caller must DEFER the item (retry next run) rather than treat it
 * as out of scope forever — see SyncResult.deferred.
 */
export class ScopeUndeterminedError extends Error {
  override readonly name = 'ScopeUndeterminedError'
  constructor(
    readonly nodeId: string,
    readonly cause: unknown,
  ) {
    super(`Could not determine scope for ${nodeId}`)
  }
}

export class ScopeResolver {
  private readonly rootId: string
  private readonly rootDriveId: string | undefined
  private readonly getFile: (fileId: string) => Promise<DriveFile>
  private readonly onWarn: (message: string) => void

  /** Folder ids known to be in scope. Grows as folders move in during a run. */
  private readonly inScopeFolders: Set<string>

  /** Per-run memo. Also holds negative verdicts, which is most of the win. */
  private readonly memo = new Map<string, ScopeVerdict>()

  private apiCalls = 0

  constructor(deps: ScopeResolverDeps) {
    this.rootId = deps.rootId
    this.rootDriveId = deps.rootDriveId
    this.getFile = deps.getFile
    this.onWarn = deps.onWarn ?? (() => {})
    this.inScopeFolders = new Set(deps.knownInScope)
    this.inScopeFolders.add(deps.rootId)
  }

  /** API calls this resolver made — surfaced in SyncResult for quota reasoning. */
  get ancestryApiCalls(): number {
    return this.apiCalls
  }

  /**
   * Record a folder as in-scope mid-run.
   *
   * Called when a folder change is applied, BEFORE any file in the same page is
   * evaluated. That ordering is what lets a file whose parent folder moved in
   * earlier in the same batch resolve without an API call.
   */
  markInScope(folderId: string): void {
    this.inScopeFolders.add(folderId)
    this.memo.set(folderId, 'in')
  }

  /** Record a folder as out of scope mid-run, e.g. after it moved out. */
  markOutOfScope(folderId: string): void {
    this.inScopeFolders.delete(folderId)
    this.memo.set(folderId, 'out')
  }

  /**
   * Resolve a FOLDER by id alone.
   *
   * Distinct from resolve() because a folder is its own starting point for the
   * ancestry walk, whereas a file starts from its parents. Calling resolve()
   * with no parents would (correctly) answer 'out' for anything unknown.
   */
  async resolveFolder(folderId: string): Promise<ScopeVerdict> {
    if (folderId === this.rootId) return 'in'

    const cached = this.memo.get(folderId)
    if (cached) return cached
    if (this.inScopeFolders.has(folderId)) return 'in'

    const verdict = await this.walkUp(folderId, folderId)
    if (verdict === 'in') this.inScopeFolders.add(folderId)
    return this.remember(folderId, verdict)
  }

  async resolve(node: ScopeNode): Promise<ScopeVerdict> {
    if (node.id === this.rootId) return 'in'

    const cached = this.memo.get(node.id)
    if (cached) return cached

    // A file in a different shared drive than the root cannot be under it.
    if (node.driveId && this.rootDriveId && node.driveId !== this.rootDriveId) {
      return this.remember(node.id, 'out')
    }

    const parents = node.parents ?? []

    // Drive has been single-parent since 2020, but legacy multi-parent files
    // exist and checking every parent is free.
    for (const parent of parents) {
      if (this.inScopeFolders.has(parent)) return this.remember(node.id, 'in')
    }

    if (parents.length === 0) {
      // No parents: the top of My Drive, or an orphaned shared file. Either way
      // it is not under the root — the root itself was handled above.
      return this.remember(node.id, 'out')
    }

    for (const parent of parents) {
      const verdict = await this.walkUp(parent, node.id)
      if (verdict === 'in') {
        return this.remember(node.id, 'in')
      }
    }

    return this.remember(node.id, 'out')
  }

  /**
   * Walk the parent chain until we hit the root, a known folder, the top of
   * Drive, or the depth cap.
   *
   * Every node visited is memoized in both directions, so one walk usually
   * resolves an entire newly-created subfolder's worth of files.
   */
  private async walkUp(startId: string, forNodeId: string): Promise<ScopeVerdict> {
    const visited: string[] = []
    let currentId: string | undefined = startId

    for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth++) {
      if (currentId === undefined) break

      if (currentId === this.rootId || this.inScopeFolders.has(currentId)) {
        this.rememberAll(visited, 'in')
        for (const id of visited) this.inScopeFolders.add(id)
        return 'in'
      }

      const cached: ScopeVerdict | undefined = this.memo.get(currentId)
      if (cached) {
        this.rememberAll(visited, cached)
        if (cached === 'in') for (const id of visited) this.inScopeFolders.add(id)
        return cached
      }

      visited.push(currentId)

      let file: DriveFile
      try {
        this.apiCalls++
        file = await this.getFile(currentId)
      } catch (err) {
        // Fail CLOSED, but do not memoize: a network blip must not permanently
        // exclude a legitimate file. The caller defers the item and retries.
        throw new ScopeUndeterminedError(forNodeId, err)
      }

      if (file.driveId && this.rootDriveId && file.driveId !== this.rootDriveId) {
        this.rememberAll(visited, 'out')
        return 'out'
      }

      const nextParents = file.parents ?? []
      if (nextParents.length === 0) {
        // Reached the top of My Drive without meeting the root.
        this.rememberAll(visited, 'out')
        return 'out'
      }

      currentId = nextParents[0]
    }

    // Depth cap. Fail closed, and make it discoverable rather than silent.
    this.onWarn(
      `Ancestry walk for ${forNodeId} exceeded ${MAX_ANCESTRY_DEPTH} levels; treating as out of scope`,
    )
    this.rememberAll(visited, 'out')
    return 'out'
  }

  private remember(id: string, verdict: ScopeVerdict): ScopeVerdict {
    this.memo.set(id, verdict)
    return verdict
  }

  private rememberAll(ids: string[], verdict: ScopeVerdict): void {
    for (const id of ids) this.memo.set(id, verdict)
  }
}
