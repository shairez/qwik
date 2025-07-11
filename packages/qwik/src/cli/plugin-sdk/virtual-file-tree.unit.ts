import fs, { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { VirtualFileTree } from './virtual-file-tree';

describe('VirtualFileTree', () => {
  let tempDir: string;
  let vft: VirtualFileTree;

  beforeEach(() => {
    // Create a temporary directory for tests
    tempDir = mkdtempSync(join(tmpdir(), 'vft-test-'));
    vft = new VirtualFileTree(tempDir);
  });

  afterEach(() => {
    // Cleanup temporary directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('File Creation', () => {
    test('should stage file creation', () => {
      vft.createFile('test.txt', 'Hello World');

      expect(vft.hasPendingOperations).toBe(true);
      expect(vft.pendingOperations).toBe(1);

      const preview = vft.preview();
      expect(preview).toHaveLength(1);
      expect(preview[0]).toEqual({
        path: 'test.txt',
        type: 'create',
        content: 'Hello World',
      });
    });

    test('should throw error when creating file that already exists', () => {
      const existingFile = join(tempDir, 'existing.txt');
      fs.writeFileSync(existingFile, 'existing content');

      expect(() => {
        vft.createFile('existing.txt', 'new content');
      }).toThrow('File existing.txt already exists');
    });

    test('should throw error when creating file that is already staged', () => {
      vft.createFile('test.txt', 'content');

      expect(() => {
        vft.createFile('test.txt', 'other content');
      }).toThrow('File test.txt already exists');
    });
  });

  describe('File Modification', () => {
    test('should stage file modification for existing file', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      await vft.modifyFile('test.txt', 'modified content');

      expect(vft.hasPendingOperations).toBe(true);
      const preview = vft.preview();
      expect(preview[0]).toEqual({
        path: 'test.txt',
        type: 'modify',
        content: 'modified content',
        originalContent: 'original content',
      });
    });

    test('should throw error when modifying non-existent file', async () => {
      await expect(vft.modifyFile('nonexistent.txt', 'content')).rejects.toThrow(
        'File nonexistent.txt does not exist'
      );
    });

    test('should modify staged file', async () => {
      vft.createFile('test.txt', 'created content');
      await vft.modifyFile('test.txt', 'modified content');

      const preview = vft.preview();
      expect(preview[0].content).toBe('modified content');
      expect(preview[0].type).toBe('modify');
    });
  });

  describe('File Overwrite', () => {
    test('should overwrite existing file', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original content');

      await vft.overwriteFile('test.txt', 'overwritten content');

      const preview = vft.preview();
      expect(preview[0]).toEqual({
        path: 'test.txt',
        type: 'overwrite',
        content: 'overwritten content',
        originalContent: 'original content',
      });
    });

    test('should create file if it does not exist', async () => {
      await vft.overwriteFile('new.txt', 'new content');

      const preview = vft.preview();
      expect(preview[0]).toEqual({
        path: 'new.txt',
        type: 'create',
        content: 'new content',
        originalContent: undefined,
      });
    });
  });

  describe('File Reading', () => {
    test('should read existing file from filesystem', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'file content');

      const content = await vft.readFile('test.txt');
      expect(content).toBe('file content');
    });

    test('should read staged file content', async () => {
      vft.createFile('staged.txt', 'staged content');

      const content = await vft.readFile('staged.txt');
      expect(content).toBe('staged content');
    });

    test('should read modified file content from staging', async () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'original');

      await vft.modifyFile('test.txt', 'modified');
      const content = await vft.readFile('test.txt');
      expect(content).toBe('modified');
    });

    test('should throw error for non-existent file', async () => {
      await expect(vft.readFile('nonexistent.txt')).rejects.toThrow(
        'Failed to read file nonexistent.txt'
      );
    });
  });

  describe('File Existence', () => {
    test('should detect existing files', () => {
      const testFile = join(tempDir, 'test.txt');
      fs.writeFileSync(testFile, 'content');

      expect(vft.fileExists('test.txt')).toBe(true);
      expect(vft.fileExists('nonexistent.txt')).toBe(false);
    });

    test('should detect staged files', () => {
      vft.createFile('staged.txt', 'content');

      expect(vft.fileExists('staged.txt')).toBe(true);
    });
  });

  describe('Commit Operations', () => {
    test('should commit all staged operations', async () => {
      vft.createFile('new.txt', 'new content');
      vft.createFile('src/component.tsx', 'component content');

      await vft.commit();

      expect(vft.hasPendingOperations).toBe(false);
      expect(fs.existsSync(join(tempDir, 'new.txt'))).toBe(true);
      expect(fs.existsSync(join(tempDir, 'src/component.tsx'))).toBe(true);
      expect(fs.readFileSync(join(tempDir, 'new.txt'), 'utf-8')).toBe('new content');
    });

    test('should create directories automatically', async () => {
      vft.createFile('deep/nested/file.txt', 'nested content');

      await vft.commit();

      expect(fs.existsSync(join(tempDir, 'deep/nested/file.txt'))).toBe(true);
      expect(fs.readFileSync(join(tempDir, 'deep/nested/file.txt'), 'utf-8')).toBe(
        'nested content'
      );
    });

    test('should handle commit errors gracefully', async () => {
      // Mock fs.promises.writeFile to throw an error
      const originalWriteFile = fs.promises.writeFile;
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('Write failed'));

      vft.createFile('test.txt', 'content');

      await expect(vft.commit()).rejects.toThrow('Failed to commit file operations');

      // Restore original function
      fs.promises.writeFile = originalWriteFile;
    });
  });

  describe('Rollback Operations', () => {
    test('should discard all staged operations', () => {
      vft.createFile('test1.txt', 'content1');
      vft.createFile('test2.txt', 'content2');

      expect(vft.pendingOperations).toBe(2);

      vft.rollback();

      expect(vft.hasPendingOperations).toBe(false);
      expect(vft.pendingOperations).toBe(0);
    });
  });

  describe('Preview Operations', () => {
    test('should return relative paths in preview', () => {
      vft.createFile('file1.txt', 'content1');
      vft.createFile('src/file2.tsx', 'content2');

      const preview = vft.preview();

      expect(preview).toHaveLength(2);
      expect(preview[0].path).toBe('file1.txt');
      expect(preview[1].path).toBe('src/file2.tsx');
    });

    test('should return empty array when no operations', () => {
      const preview = vft.preview();
      expect(preview).toEqual([]);
    });
  });

  describe('FsUpdates Integration', () => {
    test('should convert to FsUpdates format', () => {
      vft.createFile('test1.txt', 'content1');
      vft.createFile('test2.txt', 'content2');

      const fsUpdates = vft.toFsUpdates();

      expect(fsUpdates.files).toHaveLength(2);
      expect(fsUpdates.files[0].content).toBeInstanceOf(Buffer);
      expect(fsUpdates.files[0].content.toString('utf-8')).toBe('content1');
      expect(fsUpdates.files[0].type).toBe('create');
    });

    test('should apply operations from FsUpdates format', () => {
      const fsUpdates = {
        files: [
          {
            path: join(tempDir, 'imported1.txt'),
            content: Buffer.from('imported content 1'),
            type: 'create',
          },
          {
            path: join(tempDir, 'imported2.txt'),
            content: 'imported content 2', // string format
            type: 'modify',
          },
        ],
      };

      vft.fromFsUpdates(fsUpdates);

      expect(vft.pendingOperations).toBe(2);
      const preview = vft.preview();
      expect(preview[0].content).toBe('imported content 1');
      expect(preview[1].content).toBe('imported content 2');
    });
  });

  describe('Complex Scenarios', () => {
    test('should handle multiple operations on same file', async () => {
      // Create file, then modify it, then overwrite it
      vft.createFile('test.txt', 'original');
      await vft.modifyFile('test.txt', 'modified');
      await vft.overwriteFile('test.txt', 'final');

      expect(vft.pendingOperations).toBe(1); // Should only have one operation for the file
      const preview = vft.preview();
      expect(preview[0].content).toBe('final');
      expect(preview[0].type).toBe('overwrite');
    });

    test('should handle nested directory creation', async () => {
      vft.createFile('a/b/c/d/file.txt', 'nested');

      await vft.commit();

      expect(fs.existsSync(join(tempDir, 'a/b/c/d/file.txt'))).toBe(true);
    });

    test('should maintain operation order in preview', () => {
      vft.createFile('file1.txt', 'content1');
      vft.createFile('file2.txt', 'content2');
      vft.createFile('file3.txt', 'content3');

      const preview = vft.preview();

      // Operations should maintain insertion order
      expect(preview.map((op) => op.path)).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);
    });
  });
});
