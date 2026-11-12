import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * Drizzle is the sole owner of this schema (decisions §8). Nothing else creates
 * or alters tables.
 *
 * Two invariants run through every table below:
 *   1. Every domain row is scoped by user_id. The only exception is the
 *      ontology's three reference tables, which are global by design — the
 *      reference-data carve-out §1 allows. See the ontology note further down.
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

/**
 * What the last probe of the user's provider found. Stored rather than computed
 * so the Settings page, and later the extract button, can render a connection
 * state without making the page load wait on someone else's API.
 */
export type ProviderHealth =
  | 'unknown'
  | 'ok'
  | 'unauthorized'
  | 'payment_required'
  | 'rate_limited'
  | 'model_rejected'
  | 'unreachable'

/* ---------------------------------------------------------- inference provider */

/**
 * Users bring their own inference credentials (decisions §11), so this is the
 * second per-user secret store — deliberately the same shape as
 * `google_accounts`, and reading its ciphertext goes through the same
 * secretbox module. One secrets module, not two.
 *
 * One row per user, and only once they have configured something: absence *is*
 * the "no provider" state, so nothing has to invent a null baseUrl.
 *
 * The key never leaves the server. `api_key_last4` exists so the UI can show
 * which key is on file without the plaintext ever being sent to the browser —
 * there is no read path that returns the key itself.
 */
export const providerSettings = pgTable('provider_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id'),

  /** Any OpenAI-compatible endpoint, stored without a trailing slash. */
  baseUrl: text('base_url').notNull(),

  /** AES-256-GCM envelope. Only src/lib/crypto/secretbox.ts may read this. */
  apiKeyEnc: text('api_key_enc').notNull(),
  /** Display only. Never enough to reconstruct the key. */
  apiKeyLast4: text('api_key_last4').notNull(),

  modelId: text('model_id').notNull(),

  /**
   * The last probe's verdict. A designed UI state rather than an error path,
   * exactly like `google_accounts.token_status` — the four states §11 names
   * (missing, revoked, out of credit, rate limited) are all here, with
   * "missing" represented by the absence of the row.
   */
  health: text('health').$type<ProviderHealth>().notNull().default('unknown'),
  /** A short, already-safe sentence. Never a raw provider body, never the key. */
  healthDetail: text('health_detail'),
  healthCheckedAt: ts('health_checked_at'),

  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

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

/**
 * Note the label mismatch: `'unread'` renders as **"Unverified"** in the UI.
 * The stored value is deliberately left alone — renaming it is a migration, and
 * the display name is presentation. Phase 2 should render these from a single
 * status→label map rather than the current hardcoded tag, which shows
 * "Unverified" on every row regardless of the column.
 */
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

    /**
     * The `drive_version` the last extraction read, and the *only* staleness
     * signal (decisions §6, second correction).
     *
     * `extracted_revision_id` cannot do this job: Drive keeps checkpoint
     * revisions for a native Doc rather than one per edit — measured at 306
     * versions against 6 revisions on this corpus — so a revision id that has
     * not moved does not mean the document has not changed. That column is
     * provenance: which version produced these claims. This one is freshness.
     */
    extractedDriveVersion: bigint('extracted_drive_version', { mode: 'number' }),

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

/* ------------------------------------------------------------- the ontology */

/**
 * Phase 2A. The design goal here is that an *invalid claim cannot be written*,
 * rather than that we remember to check. Everything below exists to move
 * ontology rules out of application code and into the catalog, because the
 * writer we are guarding against is an LLM and it will produce plausible
 * nonsense at a rate no code review catches.
 *
 * Four tables, in dependency order:
 *
 *   entity_types          the type vocabulary   ('character', 'settlement', …)
 *   predicates            the verb vocabulary   ('ruled_by', 'population', …)
 *   predicate_signatures  which (predicate, subject type, object type / value
 *                         type) combinations are legal
 *   entities / claims     the world itself
 *
 * The three reference tables are **global** — the reference-data exception ADR
 * §1 allows. One curated vocabulary, maintained in
 * `src/lib/ontology/registry.ts` and synced by `seedOntology()`; users do not
 * define their own. See ADR §15 for why this replaced an earlier per-user
 * design.
 *
 * Tenant isolation does not depend on them: it comes from `user_id`
 * participating in the `claims → entities` foreign keys below, which is
 * unchanged.
 *
 * ## Two sentinel values, and why they exist
 *
 * The signature check is a single composite foreign key from `claims` into
 * `predicate_signatures`. Postgres foreign keys use MATCH SIMPLE, which means a
 * NULL in *any* referencing column silently disables the entire constraint —
 * so an attribute claim (no object) would bypass the check completely. Rather
 * than lose the guarantee where it matters most, two NOT NULL generated columns
 * project the nullable reality onto a total key space using `'@none'`:
 *
 *   object_type_key  = coalesce(object_type, '@none')
 *   value_kind       = 'int' | 'float' | 'string' | 'date' | '@none'
 *
 * `'@none'` cannot collide with a real name: `entity_types.name` and
 * `predicates.name` are both constrained to `^[a-z][a-z0-9_]*$`.
 *
 * That one five-column FK then enforces, in the catalog, all of:
 *   - the predicate exists (no invented relationship names)
 *   - the subject's type is legal for it (domain)
 *   - the object's type is legal for it (range)
 *   - relationship-vs-attribute consistency — an attribute predicate has no
 *     signature with an object, so a claim carrying one cannot match, and vice
 *     versa. This falls out for free rather than needing its own rule.
 *   - the populated value column matches the predicate's declared value type
 *
 * What it deliberately does NOT enforce: `value_enum` membership, and
 * cardinality/contradiction. The first belongs to the Zod layer; the second is
 * Phase 3's job, and `is_functional` / `is_temporal` are carried now purely so
 * that work needs no migration.
 *
 * ## On renaming
 *
 * `entity_types.name` and `predicates.name` are the primary keys, and the FKs
 * that depend on them are ON UPDATE NO ACTION — a generated column cannot be
 * written by a cascade, so a cascading rename would fail at the FK anyway.
 * Renaming a type or predicate is therefore a deliberate data migration, not a
 * casual edit. Retyping an individual *entity* is the common case and is fully
 * supported: that FK cascades.
 */

/** Kept in sync with `predicates.value_type` and `claims.value_kind`. */
export type ValueType = 'int' | 'float' | 'string' | 'date'
export type PredicateKind = 'relationship' | 'attribute'
export type Canonicity = 'canon' | 'draft'
export type Provenance = 'user' | 'llm' | 'seed'

/** The one string that means "no object" / "no value". See the note above. */
export const NONE = '@none'

/**
 * The nine types from the ontology design, as rows rather than a pg enum:
 * adding `Starship` should be an INSERT the user can make from the frontend,
 * not a migration.
 */
export const entityTypes = pgTable(
  'entity_types',
  {
    /** Machine name, and the value that appears in every claim. */
    name: text('name').primaryKey(),

    label: text('label').notNull(),
    pluralLabel: text('plural_label').notNull(),
    description: text('description').notNull().default(''),

    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Also what guarantees '@none' can never be a real type name.
    check('entity_types_name_format', sql`${t.name} ~ '^[a-z][a-z0-9_]*$'`),
  ],
)

/**
 * The verb vocabulary — the word in the middle of a claim. A free-text
 * relationship column would let the same fact arrive as `rules`, `ruled_by`,
 * `is_ruler_of` and `governs`, producing a graph that cannot answer its own
 * questions. Making this a lookup table is the single highest-value constraint
 * in the ontology.
 *
 * `description` is not decoration: it is the text handed to the extraction
 * model. This table *is* the LLM's instruction sheet.
 */
export const predicates = pgTable(
  'predicates',
  {
    name: text('name').primaryKey(),
    kind: text('kind').$type<PredicateKind>().notNull(),

    label: text('label').notNull(),
    /** Prompt text. Written to be read by a model, not by us. */
    description: text('description').notNull().default(''),

    /**
     * Relationships are directional, so every symmetric or reciprocal fact is
     * two rows (per the ontology design). This names the other direction;
     * `married_to` points at itself. Claim generation will use it to
     * auto-materialise and dedupe the reverse claim — see docs/ontology-design.md.
     */
    inverseName: text('inverse_name'),
    isSymmetric: boolean('is_symmetric').notNull().default(false),

    /** Carried for Phase 3 conflict detection; nothing reads them yet. */
    isTemporal: boolean('is_temporal').notNull().default(false),
    isFunctional: boolean('is_functional').notNull().default(false),

    /** Attributes only. Decides which claims.value_* column must be populated. */
    valueType: text('value_type').$type<ValueType>(),
    /** Attributes only, string-valued: the closed set of legal values. Zod-enforced. */
    valueEnum: jsonb('value_enum').$type<string[] | null>(),
    unit: text('unit'),

    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'predicates_inverse_fk',
      columns: [t.inverseName],
      foreignColumns: [t.name],
    }),
    check('predicates_name_format', sql`${t.name} ~ '^[a-z][a-z0-9_]*$'`),
    check('predicates_kind', sql`${t.kind} in ('relationship', 'attribute')`),
    check(
      'predicates_value_type',
      sql`${t.valueType} is null or ${t.valueType} in ('int', 'float', 'string', 'date')`,
    ),
    // A value type is exactly what distinguishes the two kinds.
    check(
      'predicates_kind_value_type',
      sql`(${t.kind} = 'attribute') = (${t.valueType} is not null)`,
    ),
    check(
      'predicates_enum_is_string_attribute',
      sql`${t.valueEnum} is null or ${t.valueType} = 'string'`,
    ),
    check('predicates_symmetric_inverse', sql`not ${t.isSymmetric} or ${t.inverseName} = ${t.name}`),
  ],
)

/**
 * Domain and range. The predicates table stops *invented* verbs; this stops
 * nonsense *pairings* — `Ashfall (settlement) —married_to→ Bronze Crown
 * (artifact)` uses a real predicate on real entities and is still garbage.
 *
 * A table rather than two columns on `predicates` because one predicate has
 * several legal signatures (`ruled_by` accepts a settlement, region or faction
 * as subject) and because the *combination* is what matters — storing subjects
 * and objects as independent lists would permit their cross product, which is
 * wider than the truth.
 *
 * `object_type` is NOT NULL and carries `'@none'` for attribute signatures, and
 * `value_kind` is `'@none'` for relationship signatures. See the sentinel note
 * above; without it the FK from `claims` would be silently unenforced for every
 * attribute claim.
 */
export const predicateSignatures = pgTable(
  'predicate_signatures',
  {
    predicate: text('predicate').notNull(),
    subjectType: text('subject_type').notNull(),

    /** A real entity type name, or '@none' for an attribute. */
    objectType: text('object_type').notNull().default(NONE),
    /** A ValueType, or '@none' for a relationship. */
    valueKind: text('value_kind').notNull().default(NONE),

    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Also the target of the claims signature FK.
    primaryKey({ columns: [t.predicate, t.subjectType, t.objectType, t.valueKind] }),
    foreignKey({
      name: 'predicate_signatures_predicate_fk',
      columns: [t.predicate],
      foreignColumns: [predicates.name],
    }).onDelete('cascade'),
    foreignKey({
      name: 'predicate_signatures_subject_type_fk',
      columns: [t.subjectType],
      foreignColumns: [entityTypes.name],
    }).onDelete('cascade'),
    // object_type is NOT FK'd to entity_types because of the sentinel. A typo
    // here yields an unusable signature, not a corrupt claim, and the seeder
    // derives it from a typed registry.
    check(
      'predicate_signatures_object_type',
      sql`${t.objectType} = '@none' or ${t.objectType} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check(
      'predicate_signatures_value_kind',
      sql`${t.valueKind} in ('@none', 'int', 'float', 'string', 'date')`,
    ),
    // Exactly one of the two sentinels must be filled: a signature is either a
    // relationship (has an object, no value) or an attribute (the reverse).
    check(
      'predicate_signatures_exactly_one_kind',
      sql`(${t.objectType} = '@none') <> (${t.valueKind} = '@none')`,
    ),
  ],
)

/**
 * One table for all nine types (and any the user adds), because claims need a
 * single FK target and Postgres has no polymorphic foreign key. Everything that
 * would have distinguished nine tables is a claim instead.
 *
 * Only `name`, `name_variants` and type live here; per the ontology design, all
 * other facts about an entity are claims.
 */
export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),

    entityType: text('entity_type')
      .notNull()
      .references(() => entityTypes.name),

    name: text('name').notNull(),
    /** Aliases the entity matcher resolves against, alongside `name`. */
    nameVariants: jsonb('name_variants')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    /**
     * Case-folded, punctuation-stripped `name` — the entity matcher's lookup
     * key. Deliberately NOT unique: two distinct entities of one type may
     * legitimately share a name, and a unique index would make that
     * unrepresentable rather than merely worth reviewing.
     *
     * Duplicate suppression is therefore the matcher's job, not the schema's.
     * On an exact normalized hit it must resolve to the existing entity or
     * raise the collision for the user — never silently mint a second row. That
     * is the load-bearing rule; this index only makes the lookup cheap.
     */
    normalizedName: text('normalized_name').notNull(),

    /** Draft until a human confirms it. An extractor never mints canon. */
    canonicity: text('canonicity').$type<Canonicity>().notNull().default('draft'),

    summary: text('summary'),

    /** Where this entity was first seen. Nulled rather than blocking if the doc goes (§7a). */
    sourceDocumentId: uuid('source_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /**
     * `'user'` is a hand-authored entity, and is the default: an entity typed in
     * through the frontend needs no document behind it, so `source_document_id`
     * is nullable and no claim on it is required to carry a source.
     */
    createdBy: text('created_by').$type<Provenance>().notNull().default('user'),
    /** Provenance for re-extraction decisions when a user upgrades models (ADR §11). */
    extractedByModel: text('extracted_by_model'),

    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    /**
     * Not redundant with the primary key: this is the target of the composite
     * FK from `claims`, which is what makes a claim's denormalized
     * `subject_type` provably honest *and* confines a claim to its owner's
     * entities. Retyping an entity cascades into its claims through it.
     */
    unique('entities_user_id_type_uq').on(t.userId, t.id, t.entityType),
    index('entities_user_type_norm_idx').on(t.userId, t.entityType, t.normalizedName),
    index('entities_user_type_idx').on(t.userId, t.entityType),
    index('entities_user_canonicity_idx').on(t.userId, t.canonicity),
    check('entities_canonicity', sql`${t.canonicity} in ('canon', 'draft')`),
    check('entities_created_by', sql`${t.createdBy} in ('user', 'llm', 'seed')`),
  ],
)

/**
 * Relationship claims and attribute claims in one table, because everything
 * downstream of them — sourcing, canonicity, temporal bounds, the conflicts
 * view, "show me every claim citing this document" — is identical for both.
 * Two tables would mean writing all of that twice and UNION-ing every query;
 * the nullable columns are the cheaper cost.
 *
 * ## In-world time is text, not timestamptz
 *
 * `start_date` / `end_date` in the design doc cannot be Postgres dates: a world
 * has its own calendar ("Third Age, 412"; "the winter after the Sundering").
 * Each is therefore stored as the verbatim in-world label plus an optional
 * numeric sort key the user or extractor supplies for ordering. Same treatment
 * for date-valued attributes (`value_time` / `value_order`). Float rather than
 * int so an event can always be slotted between two others.
 */
export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),

    subjectId: uuid('subject_id').notNull(),
    subjectType: text('subject_type').notNull(),

    predicate: text('predicate').notNull(),

    /** Relationship claims only. */
    objectId: uuid('object_id'),
    objectType: text('object_type'),

    /** Attribute claims only — exactly one, matching the predicate's value_type. */
    valueInt: bigint('value_int', { mode: 'number' }),
    valueFloat: doublePrecision('value_float'),
    valueString: text('value_string'),
    valueTime: text('value_time'),
    valueOrder: doublePrecision('value_order'),

    /** In-world validity window. Text label + optional sort key; see above. */
    startTime: text('start_time'),
    startOrder: doublePrecision('start_order'),
    endTime: text('end_time'),
    endOrder: doublePrecision('end_order'),

    canonicity: text('canonicity').$type<Canonicity>().notNull().default('draft'),
    confidence: doublePrecision('confidence'),

    /**
     * `'user'` — hand-authored, and the default. A manual claim is complete with
     * no `claim_sources` row at all: sourcing is a property of extracted claims,
     * not a requirement of the table. ADR §7a's "vanished source" flag applies
     * only to claims that cited a document in the first place.
     */
    createdBy: text('created_by').$type<Provenance>().notNull().default('user'),
    extractedByModel: text('extracted_by_model'),

    /* -------- generated: the projection that makes the signature FK total ---- */

    objectTypeKey: text('object_type_key')
      .notNull()
      .generatedAlwaysAs(sql`coalesce(object_type, '@none')`),

    valueKind: text('value_kind')
      .notNull()
      .generatedAlwaysAs(
        sql`case
          when value_int is not null then 'int'
          when value_float is not null then 'float'
          when value_string is not null then 'string'
          when value_time is not null then 'date'
          else '@none'
        end`,
      ),

    /**
     * The identity of a claim as an assertion, so re-extracting a document is
     * an idempotent upsert rather than a duplicate. Built only from raw columns
     * — Postgres forbids a generated column reading another one.
     */
    fingerprint: text('fingerprint')
      .notNull()
      .generatedAlwaysAs(
        sql`subject_id::text
          || '|' || predicate
          || '|' || coalesce(object_id::text, '')
          || '|' || coalesce(value_int::text, '')
          || '|' || coalesce(value_float::text, '')
          || '|' || coalesce(value_string, '')
          || '|' || coalesce(value_time, '')
          || '|' || coalesce(start_time, '')
          || '|' || coalesce(end_time, '')`,
      ),

    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    /** Subject is a real entity of this user's, and really is `subject_type`. */
    foreignKey({
      name: 'claims_subject_fk',
      columns: [t.userId, t.subjectId, t.subjectType],
      foreignColumns: [entities.userId, entities.id, entities.entityType],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /** Same for the object. Not enforced when null — which is correct: attributes have none. */
    foreignKey({
      name: 'claims_object_fk',
      columns: [t.userId, t.objectId, t.objectType],
      foreignColumns: [entities.userId, entities.id, entities.entityType],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),

    /**
     * The whole ontology in one constraint. See the section header: predicate
     * existence, domain, range, relationship-vs-attribute consistency, and
     * value-column/value-type agreement all fail here as a single FK violation.
     *
     * The Zod layer runs first precisely so users see a useful message; this is
     * the backstop that cannot be forgotten or bypassed.
     */
    foreignKey({
      name: 'claims_signature_fk',
      columns: [t.predicate, t.subjectType, t.objectTypeKey, t.valueKind],
      foreignColumns: [
        predicateSignatures.predicate,
        predicateSignatures.subjectType,
        predicateSignatures.objectType,
        predicateSignatures.valueKind,
      ],
    }),

    uniqueIndex('claims_user_fingerprint_uq').on(t.userId, t.fingerprint),
    index('claims_user_subject_idx').on(t.userId, t.subjectId, t.predicate),
    index('claims_user_object_idx').on(t.userId, t.objectId, t.predicate),
    index('claims_user_predicate_idx').on(t.userId, t.predicate),
    index('claims_user_canonicity_idx').on(t.userId, t.canonicity),

    check('claims_canonicity', sql`${t.canonicity} in ('canon', 'draft')`),
    check('claims_created_by', sql`${t.createdBy} in ('user', 'llm', 'seed')`),
    check(
      'claims_object_pair',
      sql`(${t.objectId} is null) = (${t.objectType} is null)`,
    ),
    // A relationship carries no value; an attribute carries exactly one.
    check(
      'claims_value_arity',
      sql`case when ${t.objectId} is not null then 0 else 1 end =
        (case when ${t.valueInt} is not null then 1 else 0 end)
        + (case when ${t.valueFloat} is not null then 1 else 0 end)
        + (case when ${t.valueString} is not null then 1 else 0 end)
        + (case when ${t.valueTime} is not null then 1 else 0 end)`,
    ),
    // Self-relations are meaningless for every predicate in the starting
    // vocabulary. Drop this check if one ever needs them.
    check('claims_no_self_relation', sql`${t.objectId} is null or ${t.objectId} <> ${t.subjectId}`),
    check(
      'claims_time_order',
      sql`${t.startOrder} is null or ${t.endOrder} is null or ${t.endOrder} >= ${t.startOrder}`,
    ),
    check('claims_value_order', sql`${t.valueOrder} is null or ${t.valueTime} is not null`),
  ],
)

/**
 * Sourcing, as a table rather than a column: a claim can rest on several
 * passages, and ADR §7a requires the quote and its anchor to be **denormalized
 * here at extraction time** so a flagged claim can still show its evidence
 * after the source document is gone. `document_name` is snapshotted for the
 * same reason.
 */
export const claimSources = pgTable(
  'claim_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),

    /** Null once the document is hard-gone; the claim survives and is flagged (§7a). */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),

    /** Snapshots, so the citation still renders after the document vanishes. */
    documentName: text('document_name'),
    quote: text('quote'),
    /** ¶ index into the markdown export (ADR §7). */
    paragraphIndex: integer('paragraph_index'),
    /** Which revision the quote was read from, for staleness (ADR §3). */
    documentRevisionId: text('document_revision_id'),

    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('claim_sources_claim_doc_para_uq').on(t.claimId, t.documentId, t.paragraphIndex),
    index('claim_sources_user_document_idx').on(t.userId, t.documentId),
  ],
)

/* ------------------------------------------------------- extraction history */

export type ExtractionRunStatus = 'succeeded' | 'failed'
/**
 * Where a claim was lost. `'validation'` is `parseExtraction()` refusing what
 * the model emitted; `'write'` is `writeExtraction()` declining to guess at an
 * entity (its `unwritten` list). Both are a claim the document may well state
 * and the graph does not hold, which is why they share a table.
 */
export type ExtractionIssueStage = 'validation' | 'write'

/**
 * One row per attempt to extract a document — including the ones that failed.
 *
 * Without this, a document that extracted badly is indistinguishable from one
 * that extracted well: both end up `status = 'extracted'` with some claims
 * (implementation plan §6). The run is the unit the Library reports on — what
 * came back, what was kept, and what was dropped and why.
 *
 * Runs are append-only history. The *current* state of a document still lives
 * on `documents` (`status`, `extracted_drive_version`); this table answers
 * "what happened", not "where are we".
 */
export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    status: text('status').$type<ExtractionRunStatus>().notNull(),
    /** Machine code for a failed run: an `ExtractionFailure` or a provider failure reason. */
    failureCode: text('failure_code'),
    /** The sentence shown to the user for a failed run. */
    failureMessage: text('failure_message'),

    /** The model the settings asked for, and the one the provider says answered (ADR §11). */
    modelRequested: text('model_requested'),
    model: text('model'),
    /** 1 when the first reply validated clean, 2 when the repair round was spent. */
    attempts: integer('attempts'),
    responseFormat: text('response_format'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),

    /** What was read — the same pair `stampDocument` records on the document. */
    driveVersion: bigint('drive_version', { mode: 'number' }),
    revisionId: text('revision_id'),

    /** Claims that survived validation, before entity resolution. */
    claimsExtracted: integer('claims_extracted').notNull().default(0),
    claimsCreated: integer('claims_created').notNull().default(0),
    claimsAlreadyPresent: integer('claims_already_present').notNull().default(0),
    /** Reverse-direction claims generated alongside the extracted ones (§5). */
    inversesCreated: integer('inverses_created').notNull().default(0),
    sourcesCreated: integer('sources_created').notNull().default(0),
    entitiesCreated: integer('entities_created').notNull().default(0),

    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('extraction_runs_user_document_idx').on(t.userId, t.documentId, t.startedAt),
    check('extraction_runs_status', sql`${t.status} in ('succeeded', 'failed')`),
  ],
)

/**
 * A claim the model emitted that did not reach the graph, with the reason.
 *
 * `received` is the offending claim as it arrived, kept verbatim: the reason
 * alone ("'allied_to' is not in the vocabulary") is not actionable without the
 * sentence it was about, and this is also the evidence for where the vocabulary
 * is too thin.
 */
export const extractionIssues = pgTable(
  'extraction_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => extractionRuns.id, { onDelete: 'cascade' }),

    stage: text('stage').$type<ExtractionIssueStage>().notNull(),
    /** A `Rejection['code']` for validation, an `unwritten` code for write. */
    code: text('code').notNull(),
    message: text('message').notNull(),
    received: jsonb('received'),
    /** Position in the model's output across the run; null for write-stage issues. */
    position: integer('position'),

    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('extraction_issues_run_idx').on(t.runId),
    check('extraction_issues_stage', sql`${t.stage} in ('validation', 'write')`),
  ],
)

export type ProposalStatus = 'open' | 'promoted' | 'rejected'

/**
 * A predicate the model wanted and the vocabulary does not have.
 *
 * The closed vocabulary's structured way to fail (ontology-design.md, "How the
 * vocabulary grows"): rather than forcing a near-synonym or silently dropping
 * the sentence, the extractor files what it would have needed. The vocabulary
 * is global and curated, so *promoting* a proposal does not change what the
 * extractor may write — it records the decision that the registry should grow,
 * which is then a registry edit and a re-seed.
 */
export const predicateProposals = pgTable(
  'predicate_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Nulled, not cascaded: a proposal outlives the run and document that raised it. */
    runId: uuid('run_id').references(() => extractionRuns.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    documentName: text('document_name'),

    /** snake_case, as the model proposed it. */
    name: text('name').notNull(),
    description: text('description').notNull(),
    subjectType: text('subject_type'),
    /** Null when the proposal is for an attribute rather than a relationship. */
    objectType: text('object_type'),
    exampleSubject: text('example_subject'),
    exampleObject: text('example_object'),
    /** The sentence that prompted it, verbatim, with its ¶ anchor. */
    quote: text('quote'),
    paragraphIndex: integer('paragraph_index'),

    status: text('status').$type<ProposalStatus>().notNull().default('open'),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('predicate_proposals_user_status_idx').on(t.userId, t.status),
    index('predicate_proposals_user_name_idx').on(t.userId, t.name),
    check('predicate_proposals_status', sql`${t.status} in ('open', 'promoted', 'rejected')`),
  ],
)

/* ---------------------------------------------------------------- conflicts */

/**
 * `'value'` — two claims give a single-valued predicate different answers.
 * `'vanished_source'` — a claim cites only documents that have left the
 * Library (ADR §7a).
 */
export type ConflictKind = 'value' | 'vanished_source'

/**
 * Conflicts the user has looked at and accepted as they stand.
 *
 * Conflicts themselves are **derived, not stored**: they are a query over
 * `claims`, so they can never go stale against the graph they describe, and
 * resolving one by deleting or editing a claim needs no bookkeeping at all.
 * The only thing that cannot be derived is a human saying "I know — leave it",
 * and that is all this table holds.
 *
 * `key` identifies the exact situation dismissed: for `'value'` it covers the
 * subject, the predicate and the set of disagreeing claims, so a *new*
 * disagreeing claim re-opens the conflict; for `'vanished_source'` it is the
 * claim id.
 */
export const conflictDismissals = pgTable(
  'conflict_dismissals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ConflictKind>().notNull(),
    key: text('key').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conflict_dismissals_user_kind_key_uq').on(t.userId, t.kind, t.key),
    check('conflict_dismissals_kind', sql`${t.kind} in ('value', 'vanished_source')`),
  ],
)

/* ---------------------------------------------------------------- row types */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type GoogleAccount = typeof googleAccounts.$inferSelect
export type ProviderSettings = typeof providerSettings.$inferSelect
export type NewProviderSettings = typeof providerSettings.$inferInsert
export type Session = typeof sessions.$inferSelect
export type SyncState = typeof syncState.$inferSelect
export type Folder = typeof folders.$inferSelect
export type NewFolder = typeof folders.$inferInsert
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert

export type EntityTypeRow = typeof entityTypes.$inferSelect
export type NewEntityTypeRow = typeof entityTypes.$inferInsert
export type Predicate = typeof predicates.$inferSelect
export type NewPredicate = typeof predicates.$inferInsert
export type PredicateSignature = typeof predicateSignatures.$inferSelect
export type NewPredicateSignature = typeof predicateSignatures.$inferInsert
export type Entity = typeof entities.$inferSelect
export type NewEntity = typeof entities.$inferInsert
export type Claim = typeof claims.$inferSelect
export type NewClaim = typeof claims.$inferInsert
export type ClaimSource = typeof claimSources.$inferSelect
export type NewClaimSource = typeof claimSources.$inferInsert
export type ExtractionRun = typeof extractionRuns.$inferSelect
export type NewExtractionRun = typeof extractionRuns.$inferInsert
export type ExtractionIssue = typeof extractionIssues.$inferSelect
export type NewExtractionIssue = typeof extractionIssues.$inferInsert
export type PredicateProposal = typeof predicateProposals.$inferSelect
export type NewPredicateProposal = typeof predicateProposals.$inferInsert
export type ConflictDismissal = typeof conflictDismissals.$inferSelect
