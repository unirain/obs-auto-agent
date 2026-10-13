import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SHARED_SCHEMA_DOCUMENTS } from "../../src/contracts/schema.js";
// Explicit regeneration only: runtime imports never rewrite checked-in schemas.
for (const { file, schema } of SHARED_SCHEMA_DOCUMENTS)
  await writeFile(
    resolve("agents/reading/schemas", file),
    JSON.stringify(schema, null, 2) + "\n",
  );
