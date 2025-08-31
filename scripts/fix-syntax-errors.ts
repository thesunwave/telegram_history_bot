#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function fixSyntaxErrors(content: string): string {
  // Fix });, testTimeout patterns
  content = content.replace(/\}\);,\s*testTimeout/g, '}, testTimeout);');
  
  // Fix patterns like });, testTimeout in the middle of code
  content = content.replace(/(\w+\s*\}\s*\);),\s*testTimeout/g, '$1');
  
  // Fix broken it() calls with testTimeout in wrong place
  content = content.replace(
    /(\s+it\(['"`][^'"`]+['"`],\s*(?:async\s*)?\(\)\s*=>\s*\{[\s\S]*?\n\s+\}\);),\s*testTimeout/g,
    '$1, testTimeout'
  );
  
  // Remove testTimeout from middle of functions
  content = content.replace(/(\w+\([^)]*\));,\s*testTimeout/g, '$1);');
  
  return content;
}

function findTestFiles(dir: string): string[] {
  const testFiles: string[] = [];
  
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        testFiles.push(...findTestFiles(fullPath));
      } else if (item.endsWith('.test.ts')) {
        testFiles.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }
  
  return testFiles;
}

function main() {
  console.log('🔧 Fixing syntax errors in test files...\n');
  
  const testFiles = findTestFiles('tests');
  let fixedCount = 0;
  
  for (const filePath of testFiles) {
    try {
      const originalContent = readFileSync(filePath, 'utf8');
      const fixedContent = fixSyntaxErrors(originalContent);
      
      if (fixedContent !== originalContent) {
        writeFileSync(filePath, fixedContent, 'utf8');
        console.log(`✅ Fixed: ${filePath}`);
        fixedCount++;
      }
    } catch (error) {
      console.error(`❌ Error fixing ${filePath}:`, error);
    }
  }
  
  console.log(`\n🎉 Fixed ${fixedCount} files`);
}

if (require.main === module) {
  main();
}