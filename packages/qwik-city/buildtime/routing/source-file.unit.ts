import { tmpdir } from 'os';
import { basename, join } from 'path';
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import type { RouteSourceFile } from '../types';
import { createBuildContext } from '../utils/context';
import { normalizePath } from '../utils/fs';
import { getSourceFile, resolveSourceFiles, validateSourceFiles } from './source-file';

test(`error dirname@layoutname dir`, async () => {
  const ctx = await getFsDirTest('/src/routes/dirname@layoutname', 'file.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`error .spec. file`, async () => {
  const ctx = await getFsDirTest('/src/routes/dir', 'file.spec.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`error .e2e. file`, async () => {
  const ctx = await getFsDirTest('/src/routes/dir', 'file.e2e.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`error .unit. file`, async () => {
  const ctx = await getFsDirTest('/src/routes/dir', 'file.unit.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`error __test__ dir`, async () => {
  const ctx = await getFsDirTest('/src/routes/__test__', 'file.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`error __tests__ dir`, async () => {
  const ctx = await getFsDirTest('/src/routes/__tests__', 'file.tsx');
  assert.equal(ctx.diagnostics.length, 1);
});

test(`ignore common files`, async () => {
  const dotFiles = ['.gitignore', '.gitattributes', '.gitkeep', '.DS_Store', 'thumbs.db'];
  for (const f of dotFiles) {
    const ctx = await getFsDirTest('/src/routes/', f);
    assert.equal(ctx.diagnostics.length, 0);
    assert.equal(ctx.routes.length, 0);
    assert.equal(ctx.layouts.length, 0);
    assert.equal(ctx.menus.length, 0);
  }
});

async function getFsDirTest(dirPath: string, itemName: string) {
  const testAppRootDir = join(tmpdir(), 'test-app');
  const ctx = createBuildContext(testAppRootDir, {
    routesDir: join(testAppRootDir, 'src', 'routes'),
  });
  dirPath = join(testAppRootDir, '.' + dirPath);
  dirPath = normalizePath(dirPath);
  const dirName = basename(dirPath);
  const filePath = normalizePath(join(dirPath, itemName));
  const sourceFiles: RouteSourceFile[] = [];
  const sourceFile = getSourceFile(dirPath, dirName, filePath, itemName);
  if (sourceFile) {
    sourceFiles.push(sourceFile);
  }

  const resolved = await resolveSourceFiles(ctx.opts, sourceFiles);

  ctx.layouts = resolved.layouts;
  ctx.routes = resolved.routes;
  ctx.menus = resolved.menus;
  validateSourceFiles(ctx, sourceFiles);
  return ctx;
}

test.run();
