import fs from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** Represents the original state of a file before any modifications */
interface OriginalFileState {
  existed: boolean;
  content?: string;
  stats?: fs.Stats;
}

/** Represents the current state of a file after operations */
interface CurrentFileState {
  content: string;
  exists: boolean;
}

/** Represents a single operation in the transaction queue */
export interface FileOperation {
  /** Unique operation ID for tracking */
  id: string;
  /** Relative path to the file */
  path: string;
  /** Type of operation being performed */
  type: 'create' | 'modify' | 'delete' | 'append' | 'prepend';
  /** The content for this operation */
  content?: string;
  /** Transformer function for advanced operations */
  transformer?: (content: string) => string;
}

/**
 * True Virtual File Tree with queue-based transaction log.
 *
 * Operations are stored in a queue and played sequentially during commit, just like a real database
 * transaction log.
 *
 * OPTIMIZATION: Maintains a latestContent cache for O(1) read operations.
 */
export class VirtualFileTree {
  private operationQueue: FileOperation[] = [];
  private originalStates: Map<string, OriginalFileState> = new Map();
  private latestContent: Map<string, CurrentFileState> = new Map();
  private readonly rootDir: string;
  private isCommitted = false;
  private operationCounter = 0;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  /** Initialize the virtual file system by capturing the current state */
  async initialize(): Promise<void> {
    // This captures the current state as the baseline for rollback
    this.originalStates.clear();
    this.latestContent.clear();
    this.operationQueue = [];
    this.isCommitted = false;
    this.operationCounter = 0;
  }

  /** Read a file from the virtual file system (uses cached latest content for O(1) performance) */
  async readFile(path: string): Promise<string> {
    const absolutePath = resolve(this.rootDir, path);
    const relativePath = relative(this.rootDir, absolutePath);

    // Check if we have cached latest content
    const cached = this.latestContent.get(relativePath);
    if (cached) {
      if (!cached.exists) {
        throw new Error(`File ${path} does not exist`);
      }
      return cached.content;
    }

    // If not cached, read from filesystem (file hasn't been operated on)
    try {
      const stats = await fs.promises.stat(absolutePath);
      if (stats.isFile()) {
        const content = await fs.promises.readFile(absolutePath, 'utf-8');
        // Cache the filesystem content for future reads
        this.latestContent.set(relativePath, { content, exists: true });
        return content;
      }
    } catch {
      // File doesn't exist
    }

    throw new Error(`File ${path} does not exist`);
  }

  /** Check if a file exists in the virtual file system (uses cached state for O(1) performance) */
  fileExists(path: string): boolean {
    const absolutePath = resolve(this.rootDir, path);
    const relativePath = relative(this.rootDir, absolutePath);

    // Check cached latest content first
    const cached = this.latestContent.get(relativePath);
    if (cached) {
      return cached.exists;
    }

    // If not cached, check filesystem
    return fs.existsSync(absolutePath);
  }

  /** Stage a new file creation */
  async createFile(path: string, content: string): Promise<void> {
    await this._addOperation(path, 'create', content);
  }

  /** Stage a file modification (replaces entire content) */
  async modifyFile(path: string, content: string): Promise<void> {
    await this._addOperation(path, 'modify', content);
  }

  /** Append content to the end of a file */
  async appendToFile(path: string, content: string): Promise<void> {
    await this._addOperation(path, 'append', content);
  }

  /** Prepend content to the beginning of a file */
  async prependToFile(path: string, content: string): Promise<void> {
    await this._addOperation(path, 'prepend', content);
  }

  /** Transform file content using a function */
  async transformFile(path: string, transformer: (content: string) => string): Promise<void> {
    // Read current content using our optimized read
    const currentContent = await this.readFile(path).catch(() => '');
    const newContent = transformer(currentContent);
    await this._addOperation(path, 'modify', newContent);
  }

  /** Stage a file deletion */
  async deleteFile(path: string): Promise<void> {
    await this._addOperation(path, 'delete');
  }

  /** Stage a file overwrite (modify if exists, create if doesn't) */
  async overwriteFile(path: string, content: string): Promise<void> {
    const exists = this.fileExists(path);
    await this._addOperation(path, exists ? 'modify' : 'create', content);
  }

  /** Internal method to add an operation to the queue and update latest content cache */
  private async _addOperation(
    path: string,
    type: FileOperation['type'],
    content?: string
  ): Promise<void> {
    const absolutePath = resolve(this.rootDir, path);
    const relativePath = relative(this.rootDir, absolutePath);

    // Capture original state if not already captured
    if (!this.originalStates.has(relativePath)) {
      await this._captureOriginalState(relativePath, absolutePath);
    }

    // Get current state for validation
    const currentExists = this.fileExists(path);

    // Validate the operation
    const originalState = this.originalStates.get(relativePath)!;

    if (type === 'create' && (originalState.existed || currentExists)) {
      // Only allow create if file doesn't exist originally AND no operations made it exist
      const hasDeleteOperation = this.operationQueue
        .filter((op) => op.path === relativePath)
        .some((op) => op.type === 'delete');

      if (!hasDeleteOperation) {
        throw new Error(`Cannot create file ${path}: file already exists`);
      }
    }

    if (
      (type === 'modify' || type === 'delete' || type === 'append' || type === 'prepend') &&
      !currentExists
    ) {
      throw new Error(`Cannot ${type} file ${path}: file does not exist`);
    }

    // Update latest content cache based on operation
    await this._updateLatestContent(relativePath, type, content);

    // Add operation to queue
    this.operationQueue.push({
      id: `op_${++this.operationCounter}`,
      path: relativePath,
      type,
      content,
    });
  }

  /** Update the latest content cache when an operation is added */
  private async _updateLatestContent(
    relativePath: string,
    type: FileOperation['type'],
    content?: string
  ): Promise<void> {
    // Get current cached state or read from filesystem
    let currentState = this.latestContent.get(relativePath);

    if (!currentState) {
      // Not cached yet, read from filesystem
      const absolutePath = resolve(this.rootDir, relativePath);
      try {
        const stats = await fs.promises.stat(absolutePath);
        if (stats.isFile()) {
          const fileContent = await fs.promises.readFile(absolutePath, 'utf-8');
          currentState = { content: fileContent, exists: true };
        } else {
          currentState = { content: '', exists: false };
        }
      } catch {
        currentState = { content: '', exists: false };
      }
    }

    // Apply the operation to the cached state
    let newState: CurrentFileState;

    switch (type) {
      case 'create':
        newState = { content: content || '', exists: true };
        break;
      case 'modify':
        newState = { content: content || '', exists: currentState.exists };
        break;
      case 'append':
        newState = {
          content: currentState.content + (content || ''),
          exists: currentState.exists,
        };
        break;
      case 'prepend':
        newState = {
          content: (content || '') + currentState.content,
          exists: currentState.exists,
        };
        break;
      case 'delete':
        newState = { content: '', exists: false };
        break;
      default:
        newState = currentState;
    }

    this.latestContent.set(relativePath, newState);
  }

  /** Capture the original state of a file before any modifications */
  private async _captureOriginalState(relativePath: string, absolutePath: string): Promise<void> {
    const originalState: OriginalFileState = {
      existed: false,
    };

    try {
      const stats = await fs.promises.stat(absolutePath);
      if (stats.isFile()) {
        const content = await fs.promises.readFile(absolutePath, 'utf-8');
        originalState.existed = true;
        originalState.content = content;
        originalState.stats = stats;
      }
    } catch (error) {
      // File doesn't exist, which is fine
      originalState.existed = false;
    }

    this.originalStates.set(relativePath, originalState);
  }

  /** Get a preview of all operations in the queue */
  preview(): FileOperation[] {
    return this.operationQueue.map((op) => ({ ...op }));
  }

  /** Commit all operations by playing them sequentially */
  async commit(): Promise<void> {
    if (this.isCommitted) {
      throw new Error('Transaction has already been committed');
    }

    // Group operations by file to optimize directory creation
    const affectedFiles = new Set(this.operationQueue.map((op) => resolve(this.rootDir, op.path)));
    const directories = new Set<string>();

    for (const filePath of affectedFiles) {
      directories.add(dirname(filePath));
    }

    try {
      // Create all necessary directories first
      for (const dir of directories) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Execute operations for each file using cached latest content
      for (const [relativePath, latestState] of this.latestContent) {
        const absolutePath = resolve(this.rootDir, relativePath);

        if (latestState.exists) {
          await fs.promises.writeFile(absolutePath, latestState.content, 'utf-8');
        } else {
          try {
            await fs.promises.unlink(absolutePath);
          } catch {
            // File might not exist, which is fine
          }
        }
      }

      this.isCommitted = true;
    } catch (error) {
      throw new Error(`Failed to commit changes: ${error}`);
    }
  }

  /** Rollback all staged changes and restore original filesystem state */
  async rollback(): Promise<void> {
    if (this.isCommitted) {
      // If changes were committed, restore from original states
      await this._restoreOriginalState();
    } else {
      // If not committed, just clear the operation queue and latest content cache
      this.operationQueue = [];
      this.latestContent.clear();
    }
  }

  /** Restore the filesystem to its original state before any changes */
  private async _restoreOriginalState(): Promise<void> {
    const operations: Promise<void>[] = [];

    for (const [relativePath, originalState] of this.originalStates) {
      const absolutePath = resolve(this.rootDir, relativePath);

      if (originalState.existed) {
        // File existed originally - restore its content
        operations.push(fs.promises.writeFile(absolutePath, originalState.content || '', 'utf-8'));
      } else {
        // File didn't exist originally - delete it
        operations.push(
          fs.promises.unlink(absolutePath).catch(() => {
            // Ignore errors if file doesn't exist
          })
        );
      }
    }

    await Promise.all(operations);

    // Reset state
    this.operationQueue = [];
    this.latestContent.clear();
    this.originalStates.clear();
    this.isCommitted = false;
    this.operationCounter = 0;
  }

  /** Get the number of operations in the queue */
  get pendingOperations(): number {
    return this.operationQueue.length;
  }

  /** Check if there are any pending operations */
  get hasPendingChanges(): boolean {
    return this.operationQueue.length > 0 && !this.isCommitted;
  }

  /** Check if the transaction has been committed */
  get isTransactionCommitted(): boolean {
    return this.isCommitted;
  }

  /** Get all files that have been tracked (have original state captured) */
  getTrackedFiles(): string[] {
    return Array.from(this.originalStates.keys());
  }

  /** Get list of files that will be changed (for preview purposes) */
  getChangedFiles(): string[] {
    const changedFiles = new Set<string>();

    // Add all files from operations queue
    for (const operation of this.operationQueue) {
      changedFiles.add(operation.path);
    }

    return Array.from(changedFiles).sort();
  }

  /** Create a new transaction (preserves current state as baseline) */
  async createCheckpoint(): Promise<VirtualFileTreeCheckpoint> {
    return new VirtualFileTreeCheckpoint(this);
  }

  /** Convert to FsUpdates format for compatibility with existing system */
  toFsUpdates(): {
    files: Array<{ path: string; content: Buffer; type: 'create' | 'modify' | 'delete' }>;
  } {
    // Use cached latest content for efficiency
    return {
      files: Array.from(this.latestContent.entries())
        .filter(([, state]) => state.exists)
        .map(([path, state]) => ({
          path: resolve(this.rootDir, path),
          content: Buffer.from(state.content, 'utf-8'),
          type: 'modify' as const,
        })),
    };
  }
}

/** Checkpoint for nested transactions */
export class VirtualFileTreeCheckpoint {
  private savedOperations: FileOperation[];
  private savedOriginalStates: Map<string, OriginalFileState>;
  private savedLatestContent: Map<string, CurrentFileState>;
  private savedCounter: number;

  constructor(private vft: VirtualFileTree) {
    // Create deep copies of current state
    this.savedOperations = [...vft['operationQueue']];
    this.savedOriginalStates = new Map(vft['originalStates']);
    this.savedLatestContent = new Map(vft['latestContent']);
    this.savedCounter = vft['operationCounter'];
  }

  /** Restore to this checkpoint */
  restore(): void {
    this.vft['operationQueue'] = [...this.savedOperations];
    this.vft['originalStates'] = new Map(this.savedOriginalStates);
    this.vft['latestContent'] = new Map(this.savedLatestContent);
    this.vft['operationCounter'] = this.savedCounter;
    this.vft['isCommitted'] = false;
  }
}
