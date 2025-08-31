#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

function fixDuplicateTimeouts(content: string): string {
  // Find all testTimeout declarations
  const timeoutDeclarations = content.match(/const testTimeout = \d+;[^\n]*/g) || [];
  
  if (timeoutDeclarations.length <= 1) {
    return content; // No duplicates
  }
  
  // Keep only the first declaration, remove others
  let fixed = content;
  let firstFound = false;
  
  fixed = fixed.replace(/const testTimeout = \d+;[^\n]*/g, (match) => {
    if (!firstFound) {
      firstFound = true;
      return match; // Keep the first one
    }
    return ''; // Remove duplicates
  });
  
  // Clean up empty lines left by removals
  fixed = fixed.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  return fixed;
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
  console.log('🔧 Fixing duplicate testTimeout declarations...\n');
  
  const testFiles = findTestFiles('tests');
  let fixedCount = 0;
  
  for (const filePath of testFiles) {
    try {
      const originalContent = readFileSync(filePath, 'utf8');
      const fixedContent = fixDuplicateTimeouts(originalContent);
      
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