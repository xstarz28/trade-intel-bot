import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const source=resolve(process.env.DB_PATH??"backend/data/trade-intel.sqlite");
const destination=process.argv[2];
if(!destination) {
  throw new Error("Usage: node backend/backup.mjs /absolute/path/to/backup.sqlite");
}
const target=resolve(destination);
if(target===source) throw new Error("Backup destination must differ from the live database.");
mkdirSync(dirname(target),{recursive:true});
const database=new DatabaseSync(source);
try {
  const escaped=target.replace(/'/g,"''");
  database.exec(`VACUUM INTO '${escaped}'`);
  console.info(`SQLite backup created: ${target}`);
} finally {
  database.close();
}
