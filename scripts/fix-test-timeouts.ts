#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function fixTestTimeouts(content: string, filePath: string): string {
  const timeout = getTestTimeout(filePath);
  
  // Add timeout constant to describe blocks that don't have it
  if (!content.includes('testTimeout')) {
    content = content.replace(
      /(describe\(['"`][^'"`]+['"`],\s*\(\)\s*=>\s*\{)/g,
      `$1\n  const testTimeout = ${timeout}; // ${timeout/1000} seconds max per test\n`
    );
  }
  
  // Fix broken syntax like });, testTimeout
  content = content.replace(/\}\);,\s*testTimeout/g, '}, testTimeout);');
  
  // Add timeout to it() calls that don't have it
  content = content.replace(
    /(\s+it\(['"`][^'"`]+['"`],\s*(?:async\s*)?\(\)\s*=>\s*\{[\s\S]*?\n\s+\}\);)(?!\s*,\s*testTimeout)/g,
    '$1, testTimeout'
  );
  
  return content;
}

function getTestTimeout(filePath: string): number {
  const fileName = filePath.toLowerCase();
  
  if (fileName.includes('e2e')) return 45000;
  if (fileName.includes('integration')) return 30000;
  if (fileName.includes('performance')) return 20000;
  
  return 10000;
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
  console.log('🔧 Fixing test timeout syntax errors...\n');
  
  const testFiles = findTestFiles('tests');
  let fixedCount = 0;
  
  for (const filePath of testFiles) {
    try {
      const originalContent = readFileSync(filePath, 'utf8');
      const fixedContent = fixTestTimeouts(originalContent, filePath);
      
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