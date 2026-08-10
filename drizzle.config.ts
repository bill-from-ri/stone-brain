import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs outside Next, which loads .env.local for us. Match its
// precedence so `npm run db:*` sees the same values `npm run dev` does.
loadEnv({ path: ['.env.local', '.env'], quiet: true })

// Migrations run over the DIRECT connection, not the pooler — drizzle-kit needs
// a real session for DDL and advisory locks.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL_UNPOOLED (or DATABASE_URL) must be set to run drizzle-kit')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
