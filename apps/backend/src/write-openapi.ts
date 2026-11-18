import { writeFileSync } from 'node:fs';
import { spec } from './openapi';

writeFileSync(new URL('../../../docs/phase-2.1/openapi.json', import.meta.url), JSON.stringify(spec, null, 2)+'\n');
