import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/scanner/src/**/*.test.ts'], reporters: ['default', 'json'], outputFile: { json: 'docs/evidence/unit-tests.json' } } });
