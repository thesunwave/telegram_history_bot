#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

async function fixDatabaseMocks(filePath: string): Promise<boolean> {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;
    
    // Fix database mock setup
    if (content.includes('violation-repository')) {
      // Replace problematic mock setup with proper one
      const mockSetupPattern = /const mockStmt = \{[\s\S]*?\};/g;
      const properMockSetup = `const mockStmt = {
        all: vi.fn().mockResolvedValue([]),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
      };`;
      
      if (mockSetupPattern.test(content)) {
        content = content.replace(mockSetupPattern, properMockSetup);
        hasChanges = true;
        console.log(`  ✓ Fixed database mock setup`);
      }
      
      // Fix database preparation
      content = content.replace(
        /mockDb\.prepare\.mockReturnValue\(mockStmt\);/g,
        `mockDb.prepare = vi.fn().mockReturnValue(mockStmt);`
      );
      
      // Fix error handling mocks
      content = content.replace(
        /mockStmt\.all\.mockRejectedValue/g,
        `mockStmt.all = vi.fn().mockRejectedValue`
      );
      content = content.replace(
        /mockStmt\.first\.mockRejectedValue/g,
        `mockStmt.first = vi.fn().mockRejectedValue`
      );
      content = content.replace(
        /mockStmt\.run\.mockRejectedValue/g,
        `mockStmt.run = vi.fn().mockRejectedValue`
      );
      
      // Fix successful mocks
      content = content.replace(
        /mockStmt\.all\.mockResolvedValue/g,
        `mockStmt.all = vi.fn().mockResolvedValue`
      );
      content = content.replace(
        /mockStmt\.first\.mockResolvedValue/g,
        `mockStmt.first = vi.fn().mockResolvedValue`
      );
      content = content.replace(
        /mockStmt\.run\.mockResolvedValue/g,
        `mockStmt.run = vi.fn().mockResolvedValue`
      );
      
      hasChanges = true;
    }
    
    if (hasChanges) {
      fs.writeFileSync(filePath, content);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return false;
  }
}

async function main() {
  console.log('🔧 Fixing database mock issues...\n');
  
  const testFiles = [
    'tests/repositories/violation-repository-fields.test.ts',
    'tests/repositories/violation-repository.test.ts'
  ];
  
  let fixedCount = 0;
  
  for (const file of testFiles) {
    if (fs.existsSync(file)) {
      console.log(`📝 Processing: ${file}`);
      const fixed = await fixDatabaseMocks(file);
      if (fixed) {
        console.log(`✅ Fixed\n`);
        fixedCount++;
      } else {
        console.log(`ℹ️ No changes needed\n`);
      }
    } else {
      console.log(`⚠️ File not found: ${file}\n`);
    }
  }
  
  console.log(`🎉 Completed! Fixed ${fixedCount} out of ${testFiles.length} files`);
}

if (require.main === module) {
  main().catch(console.error);
}