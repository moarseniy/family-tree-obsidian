const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'cjs',
  outfile: 'dist/main.js',
  external: ['obsidian'],  // Только obsidian внешний, остальное включаем
}).catch(() => process.exit(1));
