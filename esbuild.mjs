// Bundles the extension into dist/extension.js and copies the wasm grammars
// beside it. web-tree-sitter locates its runtime wasm at load time, so the
// extension passes an absolute path (see src/languages/shared/treeSitter.ts).
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// web-tree-sitter ships ESM and CJS builds. Its ESM build uses import.meta.url,
// which is undefined inside a CommonJS bundle, so point the bundler at the CJS
// file directly. The package's exports map hides it from a plain alias.
const treeSitterCjs = {
  name: 'web-tree-sitter-cjs',
  setup(build) {
    build.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
      path: fileURLToPath(new URL('./node_modules/web-tree-sitter/web-tree-sitter.cjs', import.meta.url)),
    }));
  },
};

const watch = process.argv.includes('--watch');

// Stamp the product name and build number into the titles VS Code shows for
// the side panel. The container's title is what a person reads in the panel
// header, and it can only come from package.json, so it is written here.
//
// Corrected 2026-09-19: the older note here claimed the view's own title is
// hidden and that neither title can change at run time. Neither is true. The
// extension used to set view.title in resolveWebviewView, and VS Code rendered
// the container's title and that one joined by a colon, so the header read
// "DeepTest - Polyglot 1.0.10: DeepTest 1.0.10". The run-time assignment is
// gone; this is now the only place either title is set.
{
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const stamped = `UntangleIt - Polyglot ${pkg.version}`;
  const container = pkg.contributes.viewsContainers.activitybar[0];
  const view = pkg.contributes.views.untangleit[0];
  if (container.title !== stamped || view.name !== stamped || view.contextualTitle !== stamped) {
    container.title = stamped;
    view.name = stamped;
    view.contextualTitle = stamped;
    writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/web-tree-sitter.wasm');
for (const file of readdirSync('vendor')) {
  if (file.endsWith('.wasm')) {
    copyFileSync(`vendor/${file}`, `dist/${file}`);
  }
}

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  plugins: [treeSitterCjs],
  sourcemap: true,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
