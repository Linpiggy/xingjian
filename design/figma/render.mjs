// Calls the installed FigCli renderer; no Figma eval-based node creation.
// Run from the repository root. Set FIGMA_CLI_ENTRY to override the local installation.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.env.FIGMA_CLI_ENTRY || 'C:/Users/慕尘/.pi/agent/vendor/figma-cli/src/index.js';
if (!existsSync(entry)) throw new Error('FigCli installation not found; configure FIGMA_CLI_ENTRY.');
const input = resolve(process.argv[2] || 'design/figma/screens.json');
const screens = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(screens) || !screens.every(x => typeof x === 'string')) {
  throw new Error('Expected an array of editable JSX screen definitions.');
}
const extraArgs = process.argv.slice(3);
process.argv = [process.execPath, entry, 'render-batch', JSON.stringify(screens),
  '--collection', 'Travel Planner', '--direction', 'row', '--gap', '160', ...extraArgs];
await import(pathToFileURL(entry).href);
