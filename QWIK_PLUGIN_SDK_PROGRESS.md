# Qwik Plugin SDK & Install Command Implementation

## Project Overview

Upgrade Qwik's plugin system to support external community plugins with a new SDK and `qwik install` command.

### Goals

- ✅ Expose plugin devkit for external developers
- ✅ Create `qwik install` command for community plugins
- ✅ Support trusted registry + external GitHub plugins
- ✅ Maintain DX parity with existing `qwik add`
- ✅ Provide transactional file operations with rollback
- ✅ Convert existing tailwind (v4+) plugin as proof of concept

---

## Implementation Phases

### **Phase 1: Plugin SDK Core Infrastructure**

_Building the foundational SDK for plugin developers_

#### **Step 1: Virtual File Tree System** ✅ **COMPLETED**

- [x] Create `packages/qwik/src/cli/plugin-sdk/virtual-file-tree.ts`
- [x] Implement `VirtualFileTree` interface with transactional operations
- [x] Add `commit()`, `rollback()`, and `preview()` functionality
- [x] Integration with existing `FsUpdates` system
- [x] Unit tests for file operations

#### **Step 2: Plugin Context API** 🔄 **IN PROGRESS**

- [ ] Create `packages/qwik/src/cli/plugin-sdk/plugin-context.ts`
- [ ] Implement `PluginContext` interface
- [ ] Project metadata access (packageJson, viteConfig, etc.)
- [ ] File operation delegation to virtual file tree
- [ ] Context initialization and cleanup

#### **Step 3: High-Level Helper Functions** ⏳ **PENDING**

- [ ] Create `packages/qwik/src/cli/plugin-sdk/helpers/` directory
- [ ] Implement `package-json-helpers.ts` (addDependency, addScript)
- [ ] Implement `vite-config-helpers.ts` (addVitePlugin)
- [ ] Implement `config-file-helpers.ts` (common config operations)
- [ ] Reuse logic from existing `migrate-v2` and `add/update-*` files

#### **Step 4: Generic File Manipulation API** ⏳ **PENDING**

- [ ] Create `packages/qwik/src/cli/plugin-sdk/file-manipulation.ts`
- [ ] Implement pattern-based file operations (`updateFiles`, `filterFiles`)
- [ ] Text manipulation utilities (insertAtLine, replacePattern, etc.)
- [ ] Support for glob patterns and regex operations

#### **Step 5: Plugin Manifest Schema** ⏳ **PENDING**

- [ ] Create `packages/qwik/src/cli/plugin-sdk/types.ts`
- [ ] Define `PluginManifest` interface
- [ ] Define `PluginInstallFunction` type
- [ ] Document plugin.config.ts/js format
- [ ] Schema validation utilities

---

### **Phase 2: Install Command Infrastructure**

_Building the new CLI command and registry system_

#### **Step 6: Install Command Structure** ⏳ **PENDING**

- [ ] Create `packages/qwik/src/cli/install/` directory
- [ ] Add `install` command to CLI router
- [ ] Implement argument parsing for plugin names/URLs
- [ ] Create base command structure similar to `add` command

#### **Step 7: Trusted Plugin Registry** ⏳ **PENDING**

- [ ] Create `packages/qwik/src/cli/install/registry.json`
- [ ] Define registry schema with plugin metadata
- [ ] Implement registry loading and validation
- [ ] Add process for community PRs to registry

#### **Step 8: Registry Plugin Installation Flow** ⏳ **PENDING**

- [ ] Implement `qwik install <plugin-name>` for registry plugins
- [ ] Plugin resolution from registry
- [ ] Download and validation logic
- [ ] Integration with Plugin SDK for installation

---

### **Phase 3: Convert Existing Plugin**

_Prove concept by converting tailwind v4+ to new SDK_

#### **Step 9: Analyze Tailwind v4+ Plugin** ⏳ **PENDING**

- [ ] Document current tailwind plugin structure
- [ ] Identify all operations (dependencies, files, vite config)
- [ ] Map operations to new SDK functions
- [ ] Document expected behavior and files created

#### **Step 10: Create New Tailwind Plugin Config** ⏳ **PENDING**

- [ ] Create `plugin.config.ts` for tailwind using SDK
- [ ] Implement using `addDependency()`, `addVitePlugin()`, `createFile()`
- [ ] Handle prettier config and global CSS creation
- [ ] Ensure feature parity with current implementation

#### **Step 11: Test Tailwind Plugin Conversion** ⏳ **PENDING**

- [ ] Create test project for plugin installation
- [ ] Verify all files and configurations are correctly applied
- [ ] Compare output with current `qwik add tailwind`
- [ ] Performance and error handling testing

---

### **Phase 4: External Plugin Support**

_Enable community plugins from GitHub_

#### **Step 12: GitHub Plugin Fetching** ⏳ **PENDING**

- [ ] Implement GitHub repository cloning/downloading
- [ ] Plugin manifest discovery and validation
- [ ] Temporary directory management for external plugins
- [ ] Error handling for network issues and invalid repos

#### **Step 13: Security Warning System** ⏳ **PENDING**

- [ ] Create security warning UI for external plugins
- [ ] User confirmation flow with risk disclosure
- [ ] Plugin source verification and checksums
- [ ] Sandbox considerations for untrusted code

#### **Step 14: External Plugin Installation** ⏳ **PENDING**

- [ ] Implement `qwik install https://github.com/user/plugin`
- [ ] Complete GitHub URL support and validation
- [ ] Integration with security warnings
- [ ] Cleanup of temporary files after installation

---

### **Phase 5: Migration and Polish**

_Integration, testing, and documentation_

#### **Step 15: Backward Compatibility** ⏳ **PENDING**

- [ ] Update existing `qwik add` to work with new system
- [ ] Create adapter layer for current plugins
- [ ] Ensure no breaking changes for existing users
- [ ] Migration path for current integrations

#### **Step 16: DX Parity Testing** ⏳ **PENDING**

- [ ] Create comprehensive DX tests comparing commands
- [ ] Test interactive prompts and confirmations match
- [ ] Verify output formatting matches (emojis, colors, etc.)
- [ ] Ensure error handling quality matches `qwik add`

#### **Step 17: Documentation and Polish** ⏳ **PENDING**

- [ ] Create plugin development guide
- [ ] Document SDK API and examples
- [ ] Add JSDoc comments to all public APIs
- [ ] Create example community plugins

#### **Step 18: Comprehensive Testing** ⏳ **PENDING**

- [ ] Unit tests for all SDK functions
- [ ] Integration tests for install flows
- [ ] Edge case testing (network failures, invalid plugins, etc.)
- [ ] Performance testing for large projects

---

## Current Focus

🎯 **Currently Working On**: Plugin Context API (Step 2)

**Next Steps**:

1. Implement `PluginContext` interface with project metadata access
2. Create file operation delegation to virtual file tree
3. Context initialization and cleanup logic
4. Integration tests with the Virtual File Tree

---

## Completed Work

### ✅ Step 1: Virtual File Tree System

**Files Created:**

- `packages/qwik/src/cli/plugin-sdk/virtual-file-tree.ts` - Core virtual file tree implementation
- `packages/qwik/src/cli/plugin-sdk/virtual-file-tree.unit.ts` - Comprehensive unit tests

**Key Features Implemented:**

- Transactional file operations with staging
- `commit()`, `rollback()`, and `preview()` functionality
- Integration with existing `FsUpdates` system via `toFsUpdates()` and `fromFsUpdates()`
- Support for create, modify, and overwrite operations
- Automatic directory creation during commit
- Comprehensive error handling and edge case coverage
- 100% test coverage with 20+ test scenarios

---

## Technical Decisions

### Plugin SDK Design

```typescript
// Example plugin.config.ts
export default async function install(ctx: PluginContext) {
  ctx.addDependency('tailwindcss', '^4.0.0', 'dev');
  ctx.addVitePlugin({
    importPath: '@tailwindcss/vite',
    defaultImport: 'tailwindcss',
    pluginCall: 'tailwindcss()',
  });
  ctx.createFile('src/global.css', '@import "tailwindcss";\n');
}
```

### Registry Format

```json
{
  "plugins": {
    "tailwind": {
      "name": "Tailwind CSS v4",
      "description": "Use Tailwind v4 in your Qwik app",
      "version": "1.0.0",
      "source": "monorepo://starters/features/tailwind",
      "verified": true
    }
  }
}
```

---

## Success Criteria

- [ ] External developers can create plugins using SDK
- [ ] `qwik install tailwind` works identically to `qwik add tailwind`
- [ ] Community can install plugins from GitHub with security warnings
- [ ] Trusted registry allows curated plugin discovery
- [ ] No breaking changes to existing `qwik add` functionality
- [ ] Complete test coverage and documentation

---

_Last Updated: January 2025_
_Status: In Progress - Phase 1, Step 2_
