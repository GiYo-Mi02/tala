import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import { spec } from '../src/openapi';

test('the Phase 2.1 OpenAPI document matches its source and validates as OpenAPI 3.1', async () => {
  const path = new URL('../../../docs/phase-2.1/openapi.json', import.meta.url);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), spec);
  await SwaggerParser.validate(JSON.parse(JSON.stringify(spec)));
  assert.equal(Object.values(spec.paths).reduce((count, path) => count+Object.keys(path).length, 0), 25);
});
