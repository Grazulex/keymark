import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { PROJECT_FILE } from './paths';
import { KeymarkError } from './vault';

export interface Recipe {
  /** Shell command line. May contain {{keymark:...}} references. */
  run: string;
  /** Environment variables to inject: VAR -> secret path (or a literal containing refs). */
  env?: Record<string, string>;
  description?: string;
}

export interface ProjectConfig {
  recipes: Record<string, Recipe>;
}

export function findProjectFile(start = process.cwd()): string | undefined {
  let dir = start;
  const { root } = parse(dir);
  while (true) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return undefined;
    dir = dirname(dir);
  }
}

export function loadProject(start = process.cwd()): { file: string; config: ProjectConfig } {
  const file = findProjectFile(start);
  if (!file) {
    throw new KeymarkError(
      `No ${PROJECT_FILE} found. Run \`keymark recipe add <name> --run "..."\`.`
    );
  }
  let config: ProjectConfig;
  try {
    config = JSON.parse(readFileSync(file, 'utf-8')) as ProjectConfig;
  } catch (e) {
    throw new KeymarkError(`Cannot parse ${file}: ${(e as Error).message}`);
  }
  config.recipes ??= {};
  return { file, config };
}

export function saveProject(file: string, config: ProjectConfig): void {
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

export function upsertRecipe(name: string, recipe: Recipe, cwd = process.cwd()): string {
  const existing = findProjectFile(cwd);
  const file = existing ?? join(cwd, PROJECT_FILE);
  const config: ProjectConfig = existing ? loadProject(cwd).config : { recipes: {} };
  config.recipes[name] = recipe;
  saveProject(file, config);
  return file;
}

/**
 * Turns a recipe env map into a map of VAR -> template string with references.
 * Bare secret paths are a shorthand for `{{keymark:<path>}}`.
 */
export function recipeEnvTemplates(env: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v.includes('{{') ? v : `{{keymark:${v}}}`;
  }
  return out;
}
