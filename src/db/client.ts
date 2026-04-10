import { neon } from '@neondatabase/serverless'
import dotenv from 'dotenv'
dotenv.config()

const databaseUrl = process.env.DATABASE_URL!

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL env var')
}

export const sql = neon(databaseUrl)
