import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { VirtualFileTree } from './virtual-file-tree';

describe('VirtualFileTree - Queue-Based Transaction System', () => {
  let tempDir: string;
  let vft: VirtualFileTree;

  beforeEach(async () => {
    // Create a temporary directory for tests
    tempDir = mkdtempSync(join(tmpdir(), 'vft-test-'));
    vft = new VirtualFileTree(tempDir);
    await vft.initialize();
  });

  afterEach(() => {
    // Cleanup temporary directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Initialization and Basic Operations', () => {
    test('should initialize empty virtual file system', async () => {
      expect(vft.hasPendingChanges).toBe(false);
      expect(vft.pendingOperations).toBe(0);
      expect(vft.isTransactionCommitted).toBe(false);
    });

    test('should stage file creation', async () => {
      await vft.createFile('test.txt', 'content');

      expect(vft.hasPendingChanges).toBe(true);
      expect(vft.pendingOperations).toBe(1);

      const preview = vft.preview();
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({
        id: expect.stringMatching(/^op_\d+$/),
        path: 'test.txt',
        type: 'create',
        content: 'content',
      });
    });

    test('should read staged file content', async () => {
      await vft.createFile('test.txt', 'content');
      const content = await vft.readFile('test.txt');
      expect(content).toBe('content');
    });
  });

  describe('File Creation and Validation', () => {
    test('should throw error when creating file that already exists on filesystem', async () => {
      const testFile = join(tempDir, 'existing.txt');
      fs.writeFileSync(testFile, 'existing content');

      await expect(vft.createFile('existing.txt', 'new content')).rejects.toThrow(
        'Cannot create file'
      );
    });

    test('should allow creating file after it was deleted in transaction', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      await vft.deleteFile('test.txt');
      await vft.createFile('test.txt', 'new content');

      const preview = vft.preview();
      expect(preview).toHaveLength(2); // Delete then create operations
      expect(preview[0].type).toBe('delete');
      expect(preview[1].type).toBe('create');
      expect(preview[1].content).toBe('new content');
    });
  });

  describe('File Modification', () => {
    test('should stage file modification for existing file', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      await vft.modifyFile('test.txt', 'modified content');
      expect(vft.hasPendingChanges).toBe(true);
      const preview = vft.preview();
      expect(preview[0]).toMatchObject({
        id: expect.stringMatching(/^op_\d+$/),
        path: 'test.txt',
        type: 'modify',
        content: 'modified content',
      });
    });

    test('should throw error when modifying non-existent file', async () => {
      await expect(vft.modifyFile('nonexistent.txt', 'content')).rejects.toThrow(
        'Cannot modify file'
      );
    });

    test('should allow modifying file created in same transaction', async () => {
      await vft.createFile('test.txt', 'created content');
      await vft.modifyFile('test.txt', 'modified content');

      const preview = vft.preview();
      expect(preview).toHaveLength(2); // Create then modify operations
      expect(preview[0].type).toBe('create');
      expect(preview[1].type).toBe('modify');
      expect(preview[1].content).toBe('modified content');
    });
  });

  describe('File Deletion', () => {
    test('should stage file deletion', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'content to delete');

      await vft.deleteFile('test.txt');

      const preview = vft.preview();
      expect(preview[0]).toMatchObject({
        id: expect.stringMatching(/^op_\d+$/),
        path: 'test.txt',
        type: 'delete',
      });
    });

    test('should throw error when deleting non-existent file', async () => {
      await expect(vft.deleteFile('nonexistent.txt')).rejects.toThrow('Cannot delete file');
    });
  });

  describe('File Overwrite', () => {
    test('should overwrite existing file', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      await vft.overwriteFile('test.txt', 'overwritten content');
      const content = await vft.readFile('test.txt');
      expect(content).toBe('overwritten content');
    });

    test('should create file when overwriting non-existent file', async () => {
      await vft.overwriteFile('new.txt', 'new content');
      const content = await vft.readFile('new.txt');
      expect(content).toBe('new content');
    });
  });

  describe('Queue-Based Operations (NEW BEHAVIOR)', () => {
    test('should capture and replay multiple operations on same file', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      // Multiple operations on the same file
      await vft.modifyFile('test.txt', 'first modification');
      await vft.modifyFile('test.txt', 'second modification');

      const preview = vft.preview();
      expect(preview).toHaveLength(2); // Both operations are stored!
      expect(preview[0].content).toBe('first modification');
      expect(preview[1].content).toBe('second modification');

      // Final result should be the last modification
      const finalContent = await vft.readFile('test.txt');
      expect(finalContent).toBe('second modification');
    });

    test('should demonstrate queue behavior with append operations', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'base content');

      await vft.appendToFile('test.txt', '\nfirst append');
      await vft.appendToFile('test.txt', '\nsecond append');

      const preview = vft.preview();
      expect(preview).toHaveLength(2);
      expect(preview[0].type).toBe('append');
      expect(preview[1].type).toBe('append');

      // Final content should have both appends
      const finalContent = await vft.readFile('test.txt');
      expect(finalContent).toBe('base content\nfirst append\nsecond append');
    });

    test('should support complex operation sequences', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original');

      await vft.modifyFile('test.txt', 'modified');
      await vft.appendToFile('test.txt', ' + appended');
      await vft.prependToFile('test.txt', 'prepended + ');

      const preview = vft.preview();
      expect(preview).toHaveLength(3);

      const finalContent = await vft.readFile('test.txt');
      expect(finalContent).toBe('prepended + modified + appended');
    });

    test('should track files that have been accessed', async () => {
      const testFile = join(tempDir, 'tracked.txt');
      fs.writeFileSync(testFile, 'content');

      await vft.modifyFile('tracked.txt', 'new content');

      const trackedFiles = vft.getTrackedFiles();
      expect(trackedFiles).toContain('tracked.txt');
    });
  });

  describe('Helper Methods', () => {
    test('should support appending content with appendToFile', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'base content');

      await vft.appendToFile('test.txt', ' appended');
      const content = await vft.readFile('test.txt');
      expect(content).toBe('base content appended');
    });

    test('should support prepending content with prependToFile', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'base content');

      await vft.prependToFile('test.txt', 'prepended ');
      const content = await vft.readFile('test.txt');
      expect(content).toBe('prepended base content');
    });

    test('should support transforming content with transformFile', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'hello world');

      await vft.transformFile('test.txt', (content) => content.toUpperCase());
      const content = await vft.readFile('test.txt');
      expect(content).toBe('HELLO WORLD');
    });
  });

  describe('Commit Operations', () => {
    test('should commit all operations to filesystem', async () => {
      await vft.createFile('file1.txt', 'content1');
      await vft.createFile('file2.txt', 'content2');

      await vft.commit();

      expect(fs.readFileSync(join(tempDir, 'file1.txt'), 'utf-8')).toBe('content1');
      expect(fs.readFileSync(join(tempDir, 'file2.txt'), 'utf-8')).toBe('content2');
      expect(vft.isTransactionCommitted).toBe(true);
    });

    test('should handle complex operation sequence during commit', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original');

      await vft.modifyFile('test.txt', 'step1');
      await vft.appendToFile('test.txt', '_step2');
      await vft.prependToFile('test.txt', 'step0_');

      await vft.commit();

      const finalContent = fs.readFileSync(testFile, 'utf-8');
      expect(finalContent).toBe('step0_step1_step2');
    });

    test('should create nested directories automatically', async () => {
      await vft.createFile('nested/deep/file.txt', 'nested content');
      await vft.commit();

      const filePath = join(tempDir, 'nested', 'deep', 'file.txt');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested content');
    });

    test('should throw error when committing twice', async () => {
      await vft.createFile('test.txt', 'content');
      await vft.commit();
      await expect(vft.commit()).rejects.toThrow('Transaction has already been committed');
    });
  });

  describe('Rollback Operations - Staging Only', () => {
    test('should discard staged operations when not committed', async () => {
      await vft.createFile('test1.txt', 'content1');
      await vft.createFile('test2.txt', 'content2');

      expect(vft.pendingOperations).toBe(2);

      await vft.rollback();

      expect(vft.hasPendingChanges).toBe(false);
      expect(vft.pendingOperations).toBe(0);
      expect(fs.existsSync(join(tempDir, 'test1.txt'))).toBe(false);
      expect(fs.existsSync(join(tempDir, 'test2.txt'))).toBe(false);
    });
  });

  describe('Rollback Operations - True Restoration', () => {
    test('should restore original filesystem state after commit', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');
      const originalTime = fs.statSync(testFile).mtime;

      await vft.modifyFile('test.txt', 'modified content');
      await vft.commit();

      // Verify file was modified
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('modified content');

      // Rollback should restore original content
      await vft.rollback();
      expect(fs.readFileSync(testFile, 'utf-8')).toBe('original content');
    });

    test('should handle file creation and deletion in rollback', async () => {
      // Create a new file and delete an existing one
      const existingFile = join(tempDir, 'existing.txt');
      fs.writeFileSync(existingFile, 'existing content');

      await vft.createFile('new.txt', 'new content');
      await vft.deleteFile('existing.txt');
      await vft.commit();

      // Verify changes applied
      expect(fs.existsSync(join(tempDir, 'new.txt'))).toBe(true);
      expect(fs.existsSync(existingFile)).toBe(false);

      // Rollback should restore original state
      await vft.rollback();
      expect(fs.existsSync(join(tempDir, 'new.txt'))).toBe(false);
      expect(fs.existsSync(existingFile)).toBe(true);
      expect(fs.readFileSync(existingFile, 'utf-8')).toBe('existing content');
    });
  });

  describe('Checkpoints and Nested Transactions', () => {
    test('should create and restore checkpoints', async () => {
      await vft.createFile('test1.txt', 'content1');

      const checkpoint = await vft.createCheckpoint();
      expect(vft.pendingOperations).toBe(1);

      await vft.createFile('test2.txt', 'content2');
      expect(vft.pendingOperations).toBe(2);

      checkpoint.restore();
      expect(vft.pendingOperations).toBe(1);

      const preview = vft.preview();
      expect(preview).toHaveLength(1);
      expect(preview[0].path).toBe('test1.txt');
    });
  });

  describe('FsUpdates Integration', () => {
    test('should convert to FsUpdates format', async () => {
      await vft.createFile('test.txt', 'content1');

      const fsUpdates = vft.toFsUpdates();
      expect(fsUpdates.files).toHaveLength(1);
      expect(fsUpdates.files[0].path).toBe(join(tempDir, 'test.txt'));
      expect(fsUpdates.files[0].content).toBeInstanceOf(Buffer);
      expect(fsUpdates.files[0].content.toString('utf-8')).toBe('content1');
      expect(fsUpdates.files[0].type).toBe('modify'); // Default type in new implementation
    });

    test('should exclude deleted files from FsUpdates', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'content');

      await vft.deleteFile('test.txt');

      const fsUpdates = vft.toFsUpdates();
      expect(fsUpdates.files).toHaveLength(0);
    });
  });

  describe('Complex Real-World Scenarios', () => {
    test('should handle plugin installation scenario', async () => {
      // Simulate installing a plugin that modifies multiple files
      const packageJsonPath = join(tempDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({ dependencies: {} }, null, 2));

      // Add dependency to package.json
      await vft.transformFile('package.json', (content) => {
        const pkg = JSON.parse(content);
        pkg.dependencies = { ...pkg.dependencies, tailwindcss: '^4.0.0' };
        return JSON.stringify(pkg, null, 2);
      });

      // Create tailwind config
      await vft.createFile(
        'tailwind.config.js',
        'module.exports = { content: ["./src/**/*.tsx"] }'
      );

      // Create CSS file
      await vft.createFile('src/global.css', '@import "tailwindcss";');

      await vft.commit();

      // Verify all files were created/modified
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.dependencies.tailwindcss).toBe('^4.0.0');
      expect(fs.existsSync(join(tempDir, 'tailwind.config.js'))).toBe(true);
      expect(fs.existsSync(join(tempDir, 'src', 'global.css'))).toBe(true);
    });

    test('should handle rollback of complex scenario', async () => {
      const packageJsonPath = join(tempDir, 'package.json');
      fs.writeFileSync(packageJsonPath, JSON.stringify({ dependencies: {} }, null, 2));

      await vft.transformFile('package.json', (content) => {
        const pkg = JSON.parse(content);
        pkg.dependencies = { ...pkg.dependencies, react: '^18.0.0' };
        return JSON.stringify(pkg, null, 2);
      });

      await vft.createFile('src/App.tsx', 'export default function App() {}');

      await vft.commit();

      // Rollback should restore original state
      await vft.rollback();

      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      expect(pkg.dependencies).toEqual({});
      expect(fs.existsSync(join(tempDir, 'src', 'App.tsx'))).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle invalid file operations gracefully', async () => {
      await expect(vft.readFile('nonexistent.txt')).rejects.toThrow('does not exist');
    });

    test('should validate file paths', async () => {
      await expect(vft.createFile('', 'content')).rejects.toThrow();
    });

    test('should handle filesystem errors during commit', async () => {
      await vft.createFile('test.txt', 'content');

      // Mock filesystem error
      const originalWriteFile = fs.promises.writeFile;
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('Disk full'));

      await expect(vft.commit()).rejects.toThrow('Failed to commit changes');

      // Restore original method
      fs.promises.writeFile = originalWriteFile;
    });
  });

  describe('Performance Optimization (latestContent Cache)', () => {
    test('should use cached content for multiple reads without replaying operations', async () => {
      const testFile = join(tempDir, 'performance-test.txt');
      fs.writeFileSync(testFile, 'original content');

      // Stage multiple operations that would normally require replay
      await vft.modifyFile('performance-test.txt', 'step 1');
      await vft.appendToFile('performance-test.txt', ' + step 2');
      await vft.prependToFile('performance-test.txt', 'step 0 + ');
      await vft.appendToFile('performance-test.txt', ' + step 3');

      // Multiple reads should use cached content (O(1)) instead of replaying 4 operations each time
      const read1 = await vft.readFile('performance-test.txt');
      const read2 = await vft.readFile('performance-test.txt');
      const read3 = await vft.readFile('performance-test.txt');

      // All reads should return the same cached result
      const expectedContent = 'step 0 + step 1 + step 2 + step 3';
      expect(read1).toBe(expectedContent);
      expect(read2).toBe(expectedContent);
      expect(read3).toBe(expectedContent);

      // fileExists should also use cached state
      expect(vft.fileExists('performance-test.txt')).toBe(true);
    });

    test('should handle cache for deleted files correctly', async () => {
      const testFile = join(tempDir, 'delete-test.txt');
      fs.writeFileSync(testFile, 'content to delete');

      // File exists initially
      expect(vft.fileExists('delete-test.txt')).toBe(true);

      // Delete file - should update cache
      await vft.deleteFile('delete-test.txt');

      // Cache should reflect deletion
      expect(vft.fileExists('delete-test.txt')).toBe(false);
      await expect(vft.readFile('delete-test.txt')).rejects.toThrow('does not exist');

      // Create file again - should update cache
      await vft.createFile('delete-test.txt', 'recreated content');
      expect(vft.fileExists('delete-test.txt')).toBe(true);
      expect(await vft.readFile('delete-test.txt')).toBe('recreated content');
    });

    test('should maintain cache consistency during rollback', async () => {
      const testFile = join(tempDir, 'rollback-cache-test.txt');
      fs.writeFileSync(testFile, 'original content');

      // Stage operations that update cache
      await vft.modifyFile('rollback-cache-test.txt', 'modified content');

      // Cache should have updated content
      expect(await vft.readFile('rollback-cache-test.txt')).toBe('modified content');

      // Rollback should clear cache
      await vft.rollback();

      // Should read from filesystem again (not cached)
      expect(await vft.readFile('rollback-cache-test.txt')).toBe('original content');
    });
  });
});
