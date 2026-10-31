import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const distDir = './dist';

function fixSpecifier(fileDir, spec) {
  if (spec.endsWith('.js') || spec.endsWith('.json')) return spec;
  const resolved = resolve(fileDir, spec);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) return `${spec}/index.js`;
  return `${spec}.js`;
}

function fixImportsInFile(filePath) {
  let content = readFileSync(filePath, 'utf-8');
  const fileDir = dirname(filePath);

  content = content.replace(
    /(from\s+['"])(\.[^'"]+)(['"])/g,
    (_m, p1, p2, p3) => `${p1}${fixSpecifier(fileDir, p2)}${p3}`
  );
  content = content.replace(
    /(import\s*\(\s*['"])(\.[^'"]+)(['"]\s*\))/g,
    (_m, p1, p2, p3) => `${p1}${fixSpecifier(fileDir, p2)}${p3}`
  );

  writeFileSync(filePath, content);
}

function processDirectory(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) processDirectory(fullPath);
    else if (entry.endsWith('.js')) fixImportsInFile(fullPath);
  }
}

processDirectory(distDir);
