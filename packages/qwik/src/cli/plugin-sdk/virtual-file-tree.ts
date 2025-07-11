import fs from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** Represents a file operation that can be previewed or committed */
export interface FileOperation {
  /** Absolute path to the file */
  path: string;
  /** Type of operation being performed */
  type: 'create' | 'modify' | 'overwrite';
  /** The content that will be written to the file */
  content: string;
  /** Original content (for rollback purposes) */
  originalContent?: string;
}

/**
 * Virtual File Tree provides transactional file operations with rollback capabilities. All
 * operations are staged in memory until commit() is called.
 */
export class VirtualFileTree {
  private operations: Map<string, FileOperation> = new Map();
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  /** Read a file from the filesystem (or from staged operations) */
  async readFile(path: string): Promise<string> {
    const absolutePath = resolve(this.rootDir, path);

    // Check if there's a staged operation for this file
    const stagedOperation = this.operations.get(absolutePath);
    if (stagedOperation) {
      return stagedOperation.content;
    }

    // Otherwise read from filesystem
    try {
      return await fs.promises.readFile(absolutePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error}`);
    }
  }

  /** Check if a file exists (considering staged operations) */
  fileExists(path: string): boolean {
    const absolutePath = resolve(this.rootDir, path);

    // Check staged operations first
    const stagedOperation = this.operations.get(absolutePath);
    if (stagedOperation) {
      return true; // All our operations create/modify files, so they exist
    }

    // Check filesystem
    return fs.existsSync(absolutePath);
  }

  /** Stage a new file creation */
  createFile(path: string, content: string): void {
    const absolutePath = resolve(this.rootDir, path);

    if (this.fileExists(path)) {
      throw new Error(`File ${path} already exists. Use modifyFile() or overwriteFile() instead.`);
    }

    this.operations.set(absolutePath, {
      path: absolutePath,
      type: 'create',
      content: content,
    });
  }

  /** Stage a file modification (file must exist) */
  async modifyFile(path: string, content: string): Promise<void> {
    const absolutePath = resolve(this.rootDir, path);

    if (!this.fileExists(path)) {
      throw new Error(`File ${path} does not exist. Use createFile() instead.`);
    }

    // Store original content for rollback
    let originalContent: string | undefined;
    try {
      originalContent = await fs.promises.readFile(absolutePath, 'utf-8');
    } catch {
      // If we can't read the original, it might be a staged creation
      const stagedOp = this.operations.get(absolutePath);
      if (stagedOp) {
        originalContent = stagedOp.originalContent;
      }
    }

    this.operations.set(absolutePath, {
      path: absolutePath,
      type: 'modify',
      content: content,
      originalContent,
    });
  }

  /** Stage a file overwrite (replaces existing file or creates new one) */
  async overwriteFile(path: string, content: string): Promise<void> {
    const absolutePath = resolve(this.rootDir, path);

    let originalContent: string | undefined;
    if (this.fileExists(path)) {
      try {
        originalContent = await fs.promises.readFile(absolutePath, 'utf-8');
      } catch {
        // If we can't read the original, it might be a staged operation
        const stagedOp = this.operations.get(absolutePath);
        if (stagedOp) {
          originalContent = stagedOp.originalContent;
        }
      }
    }

    this.operations.set(absolutePath, {
      path: absolutePath,
      type: this.fileExists(path) ? 'overwrite' : 'create',
      content: content,
      originalContent,
    });
  }

  /** Get a preview of all staged operations */
  preview(): FileOperation[] {
    return Array.from(this.operations.values()).map((op) => ({
      ...op,
      // Return relative paths for preview
      path: relative(this.rootDir, op.path),
    }));
  }

  /** Commit all staged operations to the filesystem */
  async commit(): Promise<void> {
    const operations = Array.from(this.operations.values());

    try {
      // Create directories first
      const directories = new Set<string>();
      for (const operation of operations) {
        directories.add(dirname(operation.path));
      }

      // Create all necessary directories
      for (const dir of directories) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Apply all file operations
      await Promise.all(
        operations.map(async (operation) => {
          await fs.promises.writeFile(operation.path, operation.content, 'utf-8');
        })
      );

      // Clear staged operations after successful commit
      this.operations.clear();
    } catch (error) {
      throw new Error(`Failed to commit file operations: ${error}`);
    }
  }

  /** Discard all staged operations */
  rollback(): void {
    this.operations.clear();
  }

  /** Get the number of staged operations */
  get pendingOperations(): number {
    return this.operations.size;
  }

  /** Check if there are any staged operations */
  get hasPendingOperations(): boolean {
    return this.operations.size > 0;
  }

  /** Convert to FsUpdates format for compatibility with existing system */
  toFsUpdates(): {
    files: Array<{ path: string; content: Buffer; type: 'create' | 'modify' | 'overwrite' }>;
  } {
    return {
      files: Array.from(this.operations.values()).map((op) => ({
        path: op.path,
        content: Buffer.from(op.content, 'utf-8'),
        type: op.type,
      })),
    };
  }

  /** Apply operations from FsUpdates format */
  fromFsUpdates(fsUpdates: {
    files: Array<{ path: string; content: Buffer | string; type: string }>;
  }): void {
    for (const file of fsUpdates.files) {
      const content =
        typeof file.content === 'string' ? file.content : file.content.toString('utf-8');
      const absolutePath = resolve(this.rootDir, file.path);

      this.operations.set(absolutePath, {
        path: absolutePath,
        type: file.type as 'create' | 'modify' | 'overwrite',
        content,
      });
    }
  }
}
