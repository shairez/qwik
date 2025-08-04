import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runPlugin } from './plugin-context';
import { tailwindPlugin } from './tailwind-plugin';

describe('Tailwind Plugin - Minimal API Test', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tailwind-plugin-test-'));

    // Create minimal project structure
    fs.writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
          dependencies: {},
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      join(tempDir, 'vite.config.ts'),
      `import { defineConfig } from 'vite';
import { qwikVite } from '@builder.io/qwik/optimizer';

export default defineConfig({
  plugins: [
    qwikVite()
  ]
});
`
    );

    fs.mkdirSync(join(tempDir, 'src'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('should install tailwind plugin correctly using minimal API', async () => {
    // Run our tailwind plugin
    await runPlugin(tailwindPlugin, tempDir);

    // Verify package.json was updated correctly
    const packageJson = JSON.parse(fs.readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(packageJson.devDependencies).toEqual({
      tailwindcss: '^4.0.0',
      '@tailwindcss/vite': '^4.0.0',
      'prettier-plugin-tailwindcss': '^0.6.11',
    });

    // Verify vite.config.ts was updated
    const viteConfig = fs.readFileSync(join(tempDir, 'vite.config.ts'), 'utf-8');
    expect(viteConfig).toContain("import tailwindcss from '@tailwindcss/vite';");
    expect(viteConfig).toContain('tailwindcss(),');

    // Verify CSS file was created
    const cssContent = fs.readFileSync(join(tempDir, 'src/global.css'), 'utf-8');
    expect(cssContent).toBe('@import "tailwindcss";\n');

    // Verify prettier config was created
    const prettierConfig = fs.readFileSync(join(tempDir, '.prettierrc.js'), 'utf-8');
    expect(prettierConfig).toContain("plugins: ['prettier-plugin-tailwindcss']");
  });

  test('should handle errors gracefully with rollback', async () => {
    // Remove vite.config.ts to cause an error
    fs.unlinkSync(join(tempDir, 'vite.config.ts'));

    // Plugin should fail and rollback
    await expect(runPlugin(tailwindPlugin, tempDir)).rejects.toThrow('No vite.config file found');

    // Verify no changes were made (rollback worked)
    const packageJson = JSON.parse(fs.readFileSync(join(tempDir, 'package.json'), 'utf-8'));
    expect(packageJson.devDependencies).toBeUndefined();
    expect(fs.existsSync(join(tempDir, 'src/global.css'))).toBe(false);
    expect(fs.existsSync(join(tempDir, '.prettierrc.js'))).toBe(false);
  });

  test('should work with different vite config file extensions', async () => {
    // Test with .js extension
    fs.unlinkSync(join(tempDir, 'vite.config.ts'));
    fs.writeFileSync(
      join(tempDir, 'vite.config.js'),
      `import { defineConfig } from 'vite';

export default defineConfig({
  plugins: []
});
`
    );

    await runPlugin(tailwindPlugin, tempDir);

    const viteConfig = fs.readFileSync(join(tempDir, 'vite.config.js'), 'utf-8');
    expect(viteConfig).toContain("import tailwindcss from '@tailwindcss/vite';");
    expect(viteConfig).toContain('tailwindcss(),');
  });
});
