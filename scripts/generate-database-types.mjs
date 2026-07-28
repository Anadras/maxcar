import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', '--local', '--schema', 'public'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
  },
);

const output = result.stdout ?? '';

if (
  result.status !== 0 ||
  !output.includes('export type Database') ||
  output.includes('LegacyContainerRuntimeNotFoundError')
) {
  const detail = (
    result.stderr ||
    output ||
    'unknown Supabase CLI error'
  ).trim();
  throw new Error(
    `Database type generation failed without changing files:\n${detail}`,
  );
}

const destination = join(
  process.cwd(),
  'packages',
  'shared',
  'src',
  'database.types.ts',
);

writeFileSync(destination, output);
console.log(`Generated ${destination}`);
