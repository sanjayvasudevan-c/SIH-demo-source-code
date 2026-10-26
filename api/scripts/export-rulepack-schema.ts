// Writes shared/rulepack.schema.json from the zod rule pack schema. Run: npm run rules:schema --workspace api
import fs from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { packObject } from '../src/rules/schema.js';

const out = path.resolve(process.cwd(), '../shared/rulepack.schema.json');
const schema = zodToJsonSchema(packObject, { name: 'RulePack', $refStrategy: 'none' });
fs.writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Wrote ${out}`);
