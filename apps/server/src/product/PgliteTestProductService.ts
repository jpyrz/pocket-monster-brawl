import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import {
  DurableProductService,
  migrationFolder,
  seedProfiles,
  type ProductDatabase,
} from './DurableProductService.js'

export async function createTestDurableProductService(dataDirectory: string) {
  const client = new PGlite(dataDirectory)
  await migrate(drizzle(client), { migrationsFolder: migrationFolder() })
  const database: ProductDatabase = {
    query: async <T>(statement: string, parameters: unknown[] = []) => {
      const result = await client.query<T>(statement, parameters)
      return { rows: result.rows }
    },
    transaction: (work) => client.transaction((transaction) => work({
      query: async <T>(statement: string, parameters: unknown[] = []) => {
        const result = await transaction.query<T>(statement, parameters)
        return { rows: result.rows }
      },
    })),
    close: () => client.close(),
  }
  await seedProfiles(database)
  return new DurableProductService(database)
}
