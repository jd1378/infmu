// Dev loop: rebuilds on every change under src/ and serves dist/ on http://127.0.0.1:8000.

import { serveDir } from '@std/http/file-server';
import { build } from './build.ts';

const PORT = Number(Deno.env.get('PORT') ?? 8000);

// one build at a time: changes that land mid-build trigger exactly one more
let building = false;
let again = false;
async function rebuild(): Promise<void> {
  if (building) {
    again = true;
    return;
  }
  building = true;
  do {
    again = false;
    try {
      await build({ minify: false });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
  } while (again);
  building = false;
}

await rebuild();
Deno.serve({ hostname: '127.0.0.1', port: PORT }, (req) => serveDir(req, { fsRoot: 'dist', quiet: true }));

let timer = 0;
for await (const _ of Deno.watchFs('src')) {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 120);
}
