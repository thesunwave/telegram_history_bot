#!/usr/bin/env tsx

/**
 * Automated Unused Variable Fix Script
 * Automatically fixes unused variable violations by prefixing with underscore
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { glob } from 'glob';
import * as ts from 'typescript';

interface UnusedVariable {
  /** File path */
  filePath: string;
  /** Variable name */
  variableName: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Variable type (parameter, variable, import, etc.) */
  type: 'parameter' | 'variable' | 'import' | 'destructured' | 'catch';
  /** Context information */
  context: string;
  /** Whether variable can be safely prefixed */
  canPrefix: boolean;
  /** Whether variable can be safely removed */
  canRemove: boolean;
}

interface FixResult {
  /** File that was processed */
  filePath: string;
  /** Variables that were fixed */
  fixedVariables: UnusedVariable[];
  /** Variables that were removed */
  removedVariables: UnusedVariable[];
  /** Variables that couldn't be fixed */
  skippedVariables: UnusedVariable[];
  /** Whether file was modified */
  modified: boolean;
  /** Error if processing failed */
  error?: string;
}

interface FixSummary {
  /** Total files processed */
  filesProcessed: number;
  /** Files modified */
  filesModified: number;
  /** Total variables fixed */
  variablesFixed: number;
  /** Variables removed */
  variablesRemoved: number;
  /** Variables skipped */
  variablesSkipped: number;
  /** Processing errors */
  errors: string[];
}

/**
 * Unused Variable Fixer
 */
class UnusedVariableFixer {
  private projectRoot: string;
  private dryRun: boolean;
  private backupDir: string;
  private excludePatterns: string[];

  constructor(options: {
    dryRun?: boolean;
    backupDir?: string;
    excludePatterns?: string[];
  } = {}) {
    this.projectRoot = process.cwd();
    this.dryRun = options.dryRun ?? false;
    this.backupDir = options.backupDir || join(this.projectRoot, '.backup', 'unused-vars');
    this.excludePatterns = options.excludePatterns || [
      'node_modules/**',
      'dist/**',
      'build/**',
      '**/*.d.ts',
      '**/*.min.js'
    ];
  }

  /**
   * Fix unused variables in all source files
   */
  async fixUnusedVariables(): Promise<FixSummary> {
    console.log('🔧 Starting automated unused variable fixes...');
    
    if (this.dryRun) {
      console.log('🔍 Running in DRY RUN mode - no files will be modified');
    }

    // Get all source files
    const files = await this.getSourceFiles();
    console.log(`📁 Found ${files.length} source files to process`);

    // Find unused variables
    const unusedVariables = await this.findUnusedVariables(files);
    console.log(`⚠️  Found ${unusedVariables.length} unused variables`);

    if (unusedVariables.length === 0) {
      console.log('✅ No unused variables found!');
      return {
        filesProcessed: files.length,
        filesModified: 0,
        variablesFixed: 0,
        variablesRemoved: 0,
        variablesSkipped: 0,
        errors: []
      };
    }

    // Create backup if not dry run
    if (!this.dryRun) {
      await this.createBackup(files);
    }

    // Process files
    const results: FixResult[] = [];
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const fileUnusedVars = unusedVariables.filter(v => v.filePath === filePath);
        if (fileUnusedVars.length > 0) {
          const result = await this.processFile(filePath, fileUnusedVars);
          results.push(result);
          
          if (result.error) {
            errors.push(`${filePath}: ${result.error}`);
          }
        }
      } catch (error) {
        const errorMsg = `Failed to process ${filePath}: ${(error as Error).message}`;
        errors.push(errorMsg);
        console.warn(`⚠️  ${errorMsg}`);
      }
    }

    // Generate summary
    const summary: FixSummary = {
      filesProcessed: files.length,
      filesModified: results.filter(r => r.modified).length,
      variablesFixed: results.reduce((sum, r) => sum + r.fixedVariables.length, 0),
      variablesRemoved: results.reduce((sum, r) => sum + r.removedVariables.length, 0),
      variablesSkipped: results.reduce((sum, r) => sum + r.skippedVariables.length, 0),
      errors
    };

    // Validate fixes if not dry run
    if (!this.dryRun && summary.filesModified > 0) {
      await this.validateFixes(results.filter(r => r.modified));
    }

    console.log('✅ Unused variable fixes completed');
    return summary;
  }

  /**
   * Get all source files to process
   */
  private async getSourceFiles(): Promise<string[]> {
    const patterns = [
      'src/**/*.ts',
      'src/**/*.js',
      'tests/**/*.ts',
      'tests/**/*.js',
      'scripts/**/*.ts',
      'scripts/**/*.js'
    ];

    let files: string[] = [];

    for (const pattern of patterns) {
      const matchedFiles = await glob(pattern, {
        cwd: this.projectRoot,
        ignore: this.excludePatterns
      });
      files = files.concat(matchedFiles);
    }

    return [...new Set(files)].sort();
  }

  /**
   * Find unused variables using ESLint
   */
  private async findUnusedVariables(files: string[]): Promise<UnusedVariable[]> {
    const unusedVariables: UnusedVariable[] = [];

    // Run ESLint to find unused variables
    const batchSize = 50;
    const batches = this.chunkArray(files, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔍 Analyzing batch ${i + 1}/${batches.length} for unused variables`);

      try {
        const batchUnusedVars = await this.findUnusedVariablesInBatch(batch);
        unusedVariables.push(...batchUnusedVars);
      } catch (error) {
        console.warn(`⚠️  Failed to analyze batch ${i + 1}:`, error);
      }
    }

    return unusedVariables;
  }

  /**
   * Find unused variables in a batch of files
   */
  private async findUnusedVariablesInBatch(files: string[]): Promise<UnusedVariable[]> {
    const unusedVariables: UnusedVariable[] = [];

    try {
      // Run ESLint with specific rules for unused variables
      const command = `npx eslint --format json --no-eslintrc --config '{"rules":{"@typescript-eslint/no-unused-vars":"error","no-unused-vars":"error"},"parser":"@typescript-eslint/parser","parserOptions":{"ecmaVersion":2020,"sourceType":"module"}}' ${files.join(' ')}`;
      
      const output = execSync(command, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const results = JSON.parse(output);
      
      for (const result of results) {
        const filePath = result.filePath.replace(this.projectRoot + '/', '');
        
        for (const message of result.messages) {
          if (message.ruleId && 
              (message.ruleId.includes('no-unused-vars') || message.ruleId.includes('unused-vars'))) {
            
            const unusedVar = await this.parseUnusedVariable(filePath, message);
            if (unusedVar) {
              unusedVariables.push(unusedVar);
            }
          }
        }
      }
    } catch (error) {
      // ESLint exits with non-zero code when violations are found
      const errorOutput = (error as any).stdout;
      if (errorOutput) {
        try {
          const results = JSON.parse(errorOutput);
          
          for (const result of results) {
            const filePath = result.filePath.replace(this.projectRoot + '/', '');
            
            for (const message of result.messages) {
              if (message.ruleId && 
                  (message.ruleId.includes('no-unused-vars') || message.ruleId.includes('unused-vars'))) {
                
                const unusedVar = await this.parseUnusedVariable(filePath, message);
                if (unusedVar) {
                  unusedVariables.push(unusedVar);
                }
              }
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse ESLint output for unused variables');
        }
      }
    }

    return unusedVariables;
  }

  /**
   * Parse unused variable from ESLint message
   */
  private async parseUnusedVariable(filePath: string, message: any): Promise<UnusedVariable | null> {
    try {
      // Extract variable name from message
      const variableNameMatch = message.message.match(/'([^']+)' is (defined but never used|assigned a value but never used)/);
      if (!variableNameMatch) {
        return null;
      }

      const variableName = variableNameMatch[1];
      
      // Get source context
      const context = this.getSourceContext(filePath, message.line);
      
      // Determine variable type and fix strategy
      const { type, canPrefix, canRemove } = this.analyzeVariable(filePath, variableName, message.line, context);

      return {
        filePath,
        variableName,
        line: message.line,
        column: message.column,
        type,
        context,
        canPrefix,
        canRemove
      };
    } catch (error) {
      console.warn(`Failed to parse unused variable in ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get source context for a line
   */
  private getSourceContext(filePath: string, line: number): string {
    try {
      const fullPath = join(this.projectRoot, filePath);
      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      // Get the specific line
      return lines[line - 1] || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Analyze variable to determine fix strategy
   */
  private analyzeVariable(
    filePath: string,
    variableName: string,
    line: number,
    context: string
  ): { type: UnusedVariable['type']; canPrefix: boolean; canRemove: boolean } {
    const trimmedContext = context.trim();

    // Function parameters
    if (trimmedContext.includes('function') || trimmedContext.includes('=>') || 
        trimmedContext.includes('(') && trimmedContext.includes(')')) {
      return {
        type: 'parameter',
        canPrefix: true,
        canRemove: false // Parameters usually can't be removed due to function signature
      };
    }

    // Import statements
    if (trimmedContext.includes('import') && trimmedContext.includes('from')) {
      return {
        type: 'import',
        canPrefix: false,
        canRemove: true // Unused imports can be removed
      };
    }

    // Destructured variables
    if (trimmedContext.includes('{') && trimmedContext.includes('}')) {
      return {
        type: 'destructured',
        canPrefix: true,
        canRemove: true
      };
    }

    // Catch clause parameters
    if (trimmedContext.includes('catch')) {
      return {
        type: 'catch',
        canPrefix: true,
        canRemove: false
      };
    }

    // Regular variables
    return {
      type: 'variable',
      canPrefix: true,
      canRemove: true
    };
  }

  /**
   * Process a single file to fix unused variables
   */
  private async processFile(filePath: string, unusedVariables: UnusedVariable[]): Promise<FixResult> {
    const result: FixResult = {
      filePath,
      fixedVariables: [],
      removedVariables: [],
      skippedVariables: [],
      modified: false
    };

    try {
      const fullPath = join(this.projectRoot, filePath);
      const originalContent = readFileSync(fullPath, 'utf8');
      let modifiedContent = originalContent;

      // Sort variables by line number (descending) to avoid line number shifts
      const sortedVariables = [...unusedVariables].sort((a, b) => b.line - a.line);

      for (const variable of sortedVariables) {
        const fix = this.generateFix(variable, modifiedContent);
        
        if (fix.action === 'skip') {
          result.skippedVariables.push(variable);
          continue;
        }

        // Apply fix
        modifiedContent = this.applyFix(modifiedContent, variable, fix);
        
        if (fix.action === 'prefix') {
          result.fixedVariables.push(variable);
        } else if (fix.action === 'remove') {
          result.removedVariables.push(variable);
        }
      }

      // Check if content was modified
      if (modifiedContent !== originalContent) {
        result.modified = true;
        
        if (!this.dryRun) {
          writeFileSync(fullPath, modifiedContent, 'utf8');
          console.log(`✅ Fixed ${filePath}: ${result.fixedVariables.length} prefixed, ${result.removedVariables.length} removed`);
        } else {
          console.log(`🔍 Would fix ${filePath}: ${result.fixedVariables.length} prefixed, ${result.removedVariables.length} removed`);
        }
      }

    } catch (error) {
      result.error = (error as Error).message;
    }

    return result;
  }

  /**
   * Generate fix for an unused variable
   */
  private generateFix(variable: UnusedVariable, content: string): {
    action: 'prefix' | 'remove' | 'skip';
    newName?: string;
  } {
    // Skip if variable already starts with underscore
    if (variable.variableName.startsWith('_')) {
      return { action: 'skip' };
    }

    // Remove unused imports
    if (variable.type === 'import' && variable.canRemove) {
      return { action: 'remove' };
    }

    // Remove unused variables that are clearly not needed
    if (variable.type === 'variable' && variable.canRemove && 
        !this.isVariableUsedInComments(variable, content)) {
      return { action: 'remove' };
    }

    // Prefix parameters and other variables
    if (variable.canPrefix) {
      return {
        action: 'prefix',
        newName: `_${variable.variableName}`
      };
    }

    return { action: 'skip' };
  }

  /**
   * Check if variable is referenced in comments (might be used for documentation)
   */
  private isVariableUsedInComments(variable: UnusedVariable, content: string): boolean {
    const lines = content.split('\n');
    const commentRegex = /\/\/.*|\/\*[\s\S]*?\*\//g;
    
    for (const line of lines) {
      const comments = line.match(commentRegex);
      if (comments) {
        for (const comment of comments) {
          if (comment.includes(variable.variableName)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Apply fix to content
   */
  private applyFix(
    content: string,
    variable: UnusedVariable,
    fix: { action: 'prefix' | 'remove'; newName?: string }
  ): string {
    const lines = content.split('\n');
    const lineIndex = variable.line - 1;
    
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return content;
    }

    const line = lines[lineIndex];

    if (fix.action === 'prefix' && fix.newName) {
      // Replace variable name with prefixed version
      const regex = new RegExp(`\\b${this.escapeRegex(variable.variableName)}\\b`);
      lines[lineIndex] = line.replace(regex, fix.newName);
    } else if (fix.action === 'remove') {
      if (variable.type === 'import') {
        // Remove entire import line if it's a single import
        if (line.includes('import') && line.includes(variable.variableName) && 
            !line.includes(',')) {
          lines[lineIndex] = '';
        } else {
          // Remove just the variable from import list
          const regex = new RegExp(`\\s*,?\\s*${this.escapeRegex(variable.variableName)}\\s*,?`);
          lines[lineIndex] = line.replace(regex, '').replace(/,\s*}/, ' }').replace(/{\s*,/, '{ ');
        }
      } else {
        // Remove variable declaration
        const regex = new RegExp(`\\b(const|let|var)\\s+${this.escapeRegex(variable.variableName)}\\s*[=;].*?[;,]?`);
        lines[lineIndex] = line.replace(regex, '').trim();
        
        // Remove empty lines
        if (lines[lineIndex] === '') {
          lines.splice(lineIndex, 1);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Create backup of files
   */
  private async createBackup(files: string[]): Promise<void> {
    console.log('💾 Creating backup...');
    
    const { execSync } = require('child_process');
    execSync(`mkdir -p "${this.backupDir}"`, { cwd: this.projectRoot });

    for (const file of files) {
      const sourcePath = join(this.projectRoot, file);
      const backupPath = join(this.backupDir, file);
      const backupDir = join(this.backupDir, file.split('/').slice(0, -1).join('/'));
      
      if (backupDir) {
        execSync(`mkdir -p "${backupDir}"`, { cwd: this.projectRoot });
      }
      
      execSync(`cp "${sourcePath}" "${backupPath}"`, { cwd: this.projectRoot });
    }

    console.log(`💾 Backup created in ${this.backupDir}`);
  }

  /**
   * Validate fixes by running TypeScript compiler
   */
  private async validateFixes(modifiedResults: FixResult[]): Promise<void> {
    console.log('🔍 Validating fixes...');

    try {
      // Run TypeScript compiler to check for errors
      execSync('npx tsc --noEmit', {
        cwd: this.projectRoot,
        stdio: 'pipe'
      });
      
      console.log('✅ All fixes validated successfully');
    } catch (error) {
      console.warn('⚠️  TypeScript validation failed - some fixes may have introduced errors');
      console.warn('💡 Consider reviewing the changes and running tests');
    }

    // Run ESLint to check if unused variable violations are resolved
    try {
      const modifiedFiles = modifiedResults.map(r => r.filePath);
      const command = `npx eslint --format json ${modifiedFiles.join(' ')}`;
      
      execSync(command, {
        cwd: this.projectRoot,
        stdio: 'pipe'
      });
      
      console.log('✅ ESLint validation passed');
    } catch (error) {
      // Check if there are still unused variable violations
      const errorOutput = (error as any).stdout;
      if (errorOutput) {
        try {
          const results = JSON.parse(errorOutput);
          const remainingUnusedVars = results.reduce((count: number, result: any) => {
            return count + result.messages.filter((msg: any) => 
              msg.ruleId && (msg.ruleId.includes('no-unused-vars') || msg.ruleId.includes('unused-vars'))
            ).length;
          }, 0);
          
          if (remainingUnusedVars > 0) {
            console.warn(`⚠️  ${remainingUnusedVars} unused variable violations remain`);
          } else {
            console.log('✅ All unused variable violations resolved');
          }
        } catch (parseError) {
          console.warn('⚠️  Could not parse ESLint validation results');
        }
      }
    }
  }

  /**
   * Rollback changes using backup
   */
  async rollback(): Promise<void> {
    if (!existsSync(this.backupDir)) {
      throw new Error('No backup found to rollback');
    }

    console.log('🔄 Rolling back changes...');
    
    const { execSync } = require('child_process');
    execSync(`cp -r "${this.backupDir}"/* "${this.projectRoot}"/`, { cwd: this.projectRoot });
    
    console.log('✅ Changes rolled back successfully');
  }

  /**
   * Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const rollback = args.includes('--rollback');

  const fixer = new UnusedVariableFixer({ dryRun });

  try {
    if (rollback) {
      await fixer.rollback();
      return;
    }

    const summary = await fixer.fixUnusedVariables();
    
    console.log('\n📊 Fix Summary:');
    console.log(`   Files processed: ${summary.filesProcessed}`);
    console.log(`   Files modified: ${summary.filesModified}`);
    console.log(`   Variables fixed: ${summary.variablesFixed}`);
    console.log(`   Variables removed: ${summary.variablesRemoved}`);
    console.log(`   Variables skipped: ${summary.variablesSkipped}`);
    
    if (summary.errors.length > 0) {
      console.log('\n❌ Errors:');
      summary.errors.forEach(error => console.log(`   ${error}`));
    }

    if (dryRun) {
      console.log('\n💡 This was a dry run. Use without --dry-run to apply fixes.');
    } else if (summary.filesModified > 0) {
      console.log('\n💡 Next steps:');
      console.log('   1. Review the changes');
      console.log('   2. Run tests to ensure functionality');
      console.log('   3. Commit the changes');
      console.log('   4. Use --rollback if you need to undo changes');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { UnusedVariableFixer, type UnusedVariable, type FixResult, type FixSummary };