import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Drizzle is the sole owner of this schema (decisions §8). Nothing else creates
 * or alters tables.
 *
 * Two invariants run through every table below:
 *   1. Every domain row is scoped by user_id. There is no global data.
 *   2. workspace_id is carried nullable everywhere (§5) — it costs nothing now
 *      and is expensive to retrofit if a world switcher ever arrives.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/* ------------------------------------------------------------------ identity */

/**
 * Google is the sole authenticator — no passwords, no email verification of our
 * own, no recovery flow. This table exists for identity *persistence*: something
 * has to own the encrypted refresh token, scope every domain row, and be the
 * subject of our session cookie.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The identity key. Google's `sub` claim is stable for the lifetime of the
     * account. NEVER look a user up by email — emails get changed and reassigned.
     */
    googleSub: text('google_sub').notNull(),

    // Display cache, refreshed from the ID token on every login. Not authoritative.
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name'),
    pictureUrl: text('picture_url'),

    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
  },
  (t) => [
    uniqueIndex('users_google_sub_uq').on(t.googleSub),
    // Deliberately NOT unique: an email can legitimately move between accounts.
    index('users_email_idx').on(t.email),
  ],
)

export type TokenStatus = 'active' | 'invalid_grant' | 'revoked'

/**
 * Kept separate from `users` because the grant has a different lifecycle than the
 * identity (it can be revoked and re-granted without the user changing), and
 * because keeping the secret out of the row you select for display makes
 * accidental serialization to the client structurally harder.
 */
export const googleAccounts = pgTable(
  'google_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull().default('google'),
    providerAccountId: text('provider_account_id').notNull(), // == users.google_sub

    /** AES-256-GCM envelopes. Only src/lib/crypto/secretbox.ts may read these. */
    refreshTokenEnc: text('refresh_token_enc'),
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: ts('access_token_expires_at'),

    grantedScopes: text('granted_scopes').notNull().default(''),

    /** A dead token is a designed UI state, not an error path (§2). */
    tokenStatus: text('token_status').$type<TokenStatus>().notNull().default('active'),
    tokenInvalidAt: ts('token_invalid_at'),
    lastRefreshAt: ts('last_refresh_at'),

    connectedAt: ts('connected_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('google_accounts_user_provider_uq').on(t.userId, t.provider),
    uniqueIndex('google_accounts_provider_account_uq').on(t.provider, t.providerAccountId),
  ],
)

/**
 * Opaque DB-backed sessions rather than a stateless JWT: a JWT cannot be revoked,
 * and a sign-out that doesn't sign out is not acceptable in a multi-tenant app.
 * Only the sha256 of the cookie value is stored, so a DB dump yields no live sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    tokenHash: text('token_hash').notNull(),

    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
  ],
)

/* ---------------------------------------------------------------- sync state */

/** Persisted BFS position, so an interrupted initial crawl resumes instead of restarting. */
export type CrawlCursor = {
  queue: string[]
  pageToken: string | null
}

/**
 * One row per user — one world per user for now (§5).
 */
export const syncState = pgTable('sync_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id'),

  rootDriveFolderId: text('root_drive_folder_id'),
  rootFolderName: text('root_folder_name'),

  /**
   * Null until the initial crawl finishes. `pending` is captured from
   * changes.getStartPageToken BEFORE the crawl begins and promoted only once the
   * crawl completes — capturing it after would permanently lose every change
   * that happened during the crawl. This ordering is the most important rule in
   * the whole sync.
   */
  startPageToken: text('start_page_token'),
  pendingStartPageToken: text('pending_start_page_token'),

  initialCrawlDone: boolean('initial_crawl_done').notNull().default(false),
  crawlCursor: jsonb('crawl_cursor').$type<CrawlCursor | null>(),

  /**
   * Folders moved INTO the root: Drive reports one event but never enumerates the
   * subtree, so we queue it for a BFS crawl. Persisted so an invocation timeout
   * doesn't lose the work.
   */
  pendingSubtreeCrawls: jsonb('pending_subtree_crawls')
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  /** Generation stamp for the post-crawl reconciliation sweep. */
  sweepId: uuid('sweep_id'),

  lastSyncStartedAt: ts('last_sync_started_at'),
  lastSyncCompletedAt: ts('last_sync_completed_at'),
  lastSyncError: text('last_sync_error'),

  /** Bumped on any write, so the client can cheaply tell whether to refetch. */
  syncSeq: bigint('sync_seq', { mode: 'number' }).notNull().default(0),

  /** Lease, not an advisory lock — Neon's HTTP driver has no session to hold one in. */
  lockToken: uuid('lock_token'),
  lockAcquiredAt: ts('lock_acquired_at'),
})

/* ------------------------------------------------------------ the projection */

/**
 * Both tables below are an index and a projection of Drive, not a competing copy
 * (§3). The sync process is their only writer, so there is no write conflict to
 * adjudicate — only staleness.
 *
 * Parent links are Drive IDs, not our UUIDs. Change events arrive out of order —
 * a file's change can precede its new parent folder's — so a Drive-ID link lets
 * every upsert be unconditional and order-independent. The nullable folderId FK
 * is resolved in a cheap second pass at the end of each sync, for join convenience.
 */
export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),

    driveFolderId: text('drive_folder_id').notNull(),
    parentDriveFolderId: text('parent_drive_folder_id'), // null only for the root row
    folderId: uuid('folder_id'), // resolved parent FK, best-effort

    name: text('name').notNull(),
    path: text('path'), // e.g. '/Nevlos/History' — recomputed each sync
    depth: integer('depth').notNull().default(0),
    isRoot: boolean('is_root').notNull().default(false),

    trashed: boolean('trashed').notNull().default(false),
    /** Soft delete: moved out of the root subtree. Never hard-delete (§5, §7a). */
    removedAt: ts('removed_at'),

    driveModifiedTime: ts('drive_modified_time'),
    raw: jsonb('raw').notNull(),

    sweepId: uuid('sweep_id'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('folders_user_drive_id_uq').on(t.userId, t.driveFolderId),
    index('folders_user_parent_idx').on(t.userId, t.parentDriveFolderId),
    index('folders_user_removed_idx').on(t.userId, t.removedAt),
  ],
)

export type DocumentStatus = 'unread' | 'extracted' | 'verified'

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),

    driveFileId: text('drive_file_id').notNull(),
    parentDriveFolderId: text('parent_drive_folder_id'),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),

    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),

    /**
     * files.version — monotonically increasing, bumps on every server-side change.
     *
     * This replaces headRevisionId from decisions §6, which Google documents as
     * "only available for files with binary content" — native Google Docs have no
     * binary content, so that column would be null on every row in our corpus.
     * The §3 staleness argument is unchanged; only the field is.
     */
    driveVersion: bigint('drive_version', { mode: 'number' }),

    /**
     * files.size — populated for native Google Docs (confirmed on 46/46 of the
     * first real corpus). This is Drive's internal storage size, which includes
     * embedded images, so it is a rough proxy for length rather than a word
     * count. A true word count needs files.export, which Phase 2 does anyway.
     */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),

    /** Filled in Phase 2 from revisions.list at extraction time. Null in Phase 1. */
    headRevisionId: text('head_revision_id'),
    extractedRevisionId: text('extracted_revision_id'),

    modifiedTime: ts('modified_time'),
    createdTime: ts('created_time'),
    webViewLink: text('web_view_link'),
    iconLink: text('icon_link'),
    ownerDisplayName: text('owner_display_name'),
    ownedByMe: boolean('owned_by_me'),

    status: text('status').$type<DocumentStatus>().notNull().default('unread'),

    trashed: boolean('trashed').notNull().default(false),
    removedAt: ts('removed_at'),

    /** Verbatim files.get / changes.file payload — JSONB for fidelity, columns for queries (§6). */
    raw: jsonb('raw').notNull(),

    sweepId: uuid('sweep_id'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    syncedAt: ts('synced_at').notNull().defaultNow(),
  },
  (t) => [
    /**
     * This index is what makes restore-on-return free: a file moved out of the
     * root and back matches the same row, keeps the same documents.id, and
     * Phase 2's claims survive the round trip.
     */
    uniqueIndex('documents_user_drive_id_uq').on(t.userId, t.driveFileId),
    index('documents_user_parent_removed_idx').on(t.userId, t.parentDriveFolderId, t.removedAt),
    index('documents_user_status_idx').on(t.userId, t.status),
  ],
)

/* ---------------------------------------------------------------- row types */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type GoogleAccount = typeof googleAccounts.$inferSelect
export type Session = typeof sessions.$inferSelect
export type SyncState = typeof syncState.$inferSelect
export type Folder = typeof folders.$inferSelect
export type NewFolder = typeof folders.$inferInsert
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
