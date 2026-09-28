// Builds the static site into dist/: bundles the app and the render worker with `deno bundle`, gives each
// file a content hash (GitHub Pages caches for 10 minutes; hashed names can't go stale) and writes the pages.
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
  const args = ['bundle', '--platform', 'browser', '--outdir', tmp, 'src/worker.ts', ...PAGES.map((p) => p.script)];
  if (minify) args.push('--minify');
  const { success, stderr } = await new Deno.Command(Deno.execPath(), { args, stdout: 'null', stderr: 'piped' })
    .output();
  if (!success) throw new Error(`deno bundle failed:\n${new TextDecoder().decode(stderr)}`);

  const worker = await Deno.readTextFile(`${tmp}/worker.js`);
  const workerName = `worker.${await sha(worker)}.js`;
  const kb = (s: string) => `${(new TextEncoder().encode(s).length / 1024).toFixed(1)} KB`;
  const built: string[] = [];
  // each page's script shares the one render worker
  for (const page of PAGES) {
    const name = page.script.replace(/^src\/|\.ts$/g, '');
    let script = await Deno.readTextFile(`${tmp}/${name}.js`);
    if (!script.includes('./worker.js')) throw new Error(`${name} bundle does not reference ./worker.js`);
    script = script.replaceAll('./worker.js', `./${workerName}`);
    const scriptName = `${name}.${await sha(script)}.js`;
    let html = await Deno.readTextFile(page.html);
    if (!html.includes(`./${name}.js`)) throw new Error(`${page.html} does not reference ./${name}.js`);
    html = html.replace(`./${name}.js`, `./${scriptName}`);
    await Deno.writeTextFile(`${DIST}/${scriptName}`, script);
    await Deno.writeTextFile(`${DIST}/${page.html.replace(/^src\//, '')}`, html);
    built.push(`${page.html.replace(/^src\//, '')} ${kb(html)}, ${scriptName} ${kb(script)}`);
  }

  // static files (the link preview image) go next to the page as they are
  for await (const f of Deno.readDir('public')) {
    if (f.isFile) await Deno.copyFile(`public/${f.name}`, `${DIST}/${f.name}`);
  }
  await Deno.writeTextFile(`${DIST}/${workerName}`, worker);
  await Deno.remove(tmp, { recursive: true });
  console.log(`built ${DIST}/: ${built.join(', ')}, ${workerName} ${kb(worker)}`);
}

/** The site's pages and the script each loads. */
const PAGES = [
  { html: 'src/index.html', script: 'src/main.ts' },
  { html: 'src/instruments.html', script: 'src/instruments.ts' },
];

if (import.meta.main) await build({ minify: true });
