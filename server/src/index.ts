import { createApp } from './app.ts';
import { NeonHttpSql } from './sql.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL не задан');

export default createApp({ sql: new NeonHttpSql(databaseUrl) });
