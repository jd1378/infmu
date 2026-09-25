// Builds the static site into dist/: bundles the app and the render worker with `deno bundle`, gives each
// file a content hash (GitHub Pages caches for 10 minutes; hashed names can't go stale) and writes index.html.
//
//   deno task build        minified production build
//   (scripts/dev.ts calls build({ minify: false }) on every change)

const DIST = 'dist';

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 5).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `clean` empties dist/ first (production). The dev loop keeps earlier bundles, so a tab opened before a
 * rebuild can still start workers from the files it was loaded with.
 */
export async function build({ minify, clean = true }: { minify: boolean; clean?: boolean }): Promise<void> {
  const tmp = `${DIST}/.bundle`;
  if (clean) await Deno.remove(DIST, { recursive: true }).catch(() => {});
  else await Deno.remove(tmp, { recursive: true }).catch(() => {});
  await Deno.mkdir(tmp, { recursive: true });
  const args = ['bundle', '--platform', 'browser', '--outdir', tmp, 'src/main.ts', 'src/worker.ts'];
  if (minify) args.push('--minify');
  const { success, stderr } = await new Deno.Command(Deno.execPath(), { args, stdout: 'null', stderr: 'piped' })
    .output();
  if (!success) throw new Error(`deno bundle failed:\n${new TextDecoder().decode(stderr)}`);

  const worker = await Deno.readTextFile(`${tmp}/worker.js`);
  const workerName = `worker.${await sha(worker)}.js`;
  let main = await Deno.readTextFile(`${tmp}/main.js`);
  if (!main.includes('./worker.js')) throw new Error('main bundle does not reference ./worker.js');
  main = main.replaceAll('./worker.js', `./${workerName}`);
  const mainName = `main.${await sha(main)}.js`;

  let html = await Deno.readTextFile('src/index.html');
  if (!html.includes('./main.js')) throw new Error('index.html does not reference ./main.js');
  html = html.replace('./main.js', `./${mainName}`);

  // static files (the link preview image) go next to the page as they are
  for await (const f of Deno.readDir('public')) {
    if (f.isFile) await Deno.copyFile(`public/${f.name}`, `${DIST}/${f.name}`);
  }
  await Deno.writeTextFile(`${DIST}/${workerName}`, worker);
  await Deno.writeTextFile(`${DIST}/${mainName}`, main);
  await Deno.writeTextFile(`${DIST}/index.html`, html);
  await Deno.remove(tmp, { recursive: true });
  const kb = (s: string) => `${(new TextEncoder().encode(s).length / 1024).toFixed(1)} KB`;
  console.log(`built ${DIST}/: index.html ${kb(html)}, ${mainName} ${kb(main)}, ${workerName} ${kb(worker)}`);
}

if (import.meta.main) await build({ minify: true });
