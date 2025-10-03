#!/usr/bin/env tsx

/**
 * Fix Validation Script
 * Validates that automated fixes don't break functionality
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  /** Validation type */
  type: 'typescript' | 'eslint' | 'tests' | 'build';
  /** Whether validation passed */
  passed: boolean;
  /** Validation output */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  executionTime: number;
}

interface ValidationSummary {
  /** Overall validation status */
  passed: boolean;
  /** Individual validation results */
  results: ValidationResult[];
  /** Total execution time */
  totalTime: number;
  /** Validation timestamp */
  timestamp: Date;
}

/**
 * Fix Validator
 */
class FixValidator {
  private projectRoot: string;
  private enabledValidations: string[];

  constructor(enabledValidations: string[] = ['typescript', 'eslint', 'tests']) {
    this.projectRoot = process.cwd();
    this.enabledValidations = enabledValidations;
  }

  /**
   * Run all validations
   */
  async validateFixes(): Promise<ValidationSummary> {
    console.log('🔍 Starting fix validation...');
    
    const startTime = Date.now();
    const results: ValidationResult[] = [];

    // Run TypeScript validation
    if (this.enabledValidations.includes('typescript')) {
      const tsResult = await this.validateTypeScript();
      results.push(tsResult);
    }

    // Run ESLint validation
    if (this.enabledValidations.includes('eslint')) {
      const eslintResult = await this.validateESLint();
      results.push(eslintResult);
    }

    // Run tests
    if (this.enabledValidations.includes('tests')) {
      const testResult = await this.validateTests();
      results.push(testResult);
    }

    // Run build
    if (this.enabledValidations.includes('build')) {
      const buildResult = await this.validateBuild();
      results.push(buildResult);
    }

    const totalTime = Date.now() - startTime;
    const passed = results.every(result => result.passed);

    const summary: ValidationSummary = {
      passed,
      results,
      totalTime,
      timestamp: new Date()
    };

    // Save validation report
    await this.saveValidationReport(summary);

    return summary;
  }

  /**
   * Validate TypeScript compilation
   */
  private async validateTypeScript(): Promise<ValidationResult> {
    console.log('🔍 Validating TypeScript compilation...');
    const startTime = Date.now();

    try {
      const output = execSync('npx tsc --noEmit', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      return {
        type: 'typescript',
        passed: true,
        output: output || 'TypeScript compilation successful',
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      
      return {
        type: 'typescript',
        passed: false,
        output: errorOutput,
        error: 'TypeScript compilation failed',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate ESLint rules
   */
  private async validateESLint(): Promise<ValidationResult> {
    console.log('🔍 Validating ESLint rules...');
    const startTime = Date.now();

    try {
      const output = execSync('npx eslint src tests scripts --format compact', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      return {
        type: 'eslint',
        passed: true,
        output: output || 'ESLint validation successful',
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      
      // Check if there are only warnings (exit code 1) vs errors (exit code 2)
      const exitCode = (error as any).status;
      const hasOnlyWarnings = exitCode === 1 && !errorOutput.includes('error');
      
      return {
        type: 'eslint',
        passed: hasOnlyWarnings,
        output: errorOutput,
        error: hasOnlyWarnings ? undefined : 'ESLint validation failed with errors',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate tests
   */
  private async validateTests(): Promise<ValidationResult> {
    console.log('🔍 Running tests...');
    const startTime = Date.now();

    try {
      // Check if we have a test script
      const packageJson = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'));
      const testScript = packageJson.scripts?.test;

      if (!testScript) {
        return {
          type: 'tests',
          passed: true,
          output: 'No test script found - skipping test validation',
          executionTime: Date.now() - startTime
        };
      }

      const output = execSync('npm test', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300000 // 5 minute timeout
      });

      return {
        type: 'tests',
        passed: true,
        output: output || 'All tests passed',
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      
      return {
        type: 'tests',
        passed: false,
        output: errorOutput,
        error: 'Tests failed',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate build process
   */
  private async validateBuild(): Promise<ValidationResult> {
    console.log('🔍 Validating build process...');
    const startTime = Date.now();

    try {
      // Check if we have a build script
      const packageJson = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'));
      const buildScript = packageJson.scripts?.build;

      if (!buildScript) {
        return {
          type: 'build',
          passed: true,
          output: 'No build script found - skipping build validation',
          executionTime: Date.now() - startTime
        };
      }

      const output = execSync('npm run build', {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 300000 // 5 minute timeout
      });

      return {
        type: 'build',
        passed: true,
        output: output || 'Build successful',
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      
      return {
        type: 'build',
        passed: false,
        output: errorOutput,
        error: 'Build failed',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Save validation report
   */
  private async saveValidationReport(summary: ValidationSummary): Promise<void> {
    const reportsDir = join(this.projectRoot, 'reports', 'validation');
    const { execSync } = require('child_process');
    execSync(`mkdir -p "${reportsDir}"`, { cwd: this.projectRoot });

    const timestamp = summary.timestamp.toISOString().replace(/[:.]/g, '-');
    const reportPath = join(reportsDir, `validation-${timestamp}.json`);
    
    writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    
    // Also save as latest
    const latestPath = join(reportsDir, 'latest-validation.json');
    writeFileSync(latestPath, JSON.stringify(summary, null, 2));

    console.log(`📄 Validation report saved: ${reportPath}`);
  }

  /**
   * Generate validation report summary
   */
  generateSummary(summary: ValidationSummary): string {
    const passedCount = summary.results.filter(r => r.passed).length;
    const totalCount = summary.results.length;
    
    let report = `\n📊 Validation Summary:\n`;
    report += `   Overall Status: ${summary.passed ? '✅ PASSED' : '❌ FAILED'}\n`;
    report += `   Validations: ${passedCount}/${totalCount} passed\n`;
    report += `   Total Time: ${(summary.totalTime / 1000).toFixed(2)}s\n\n`;

    for (const result of summary.results) {
      const status = result.passed ? '✅' : '❌';
      const time = (result.executionTime / 1000).toFixed(2);
      
      report += `${status} ${result.type.toUpperCase()} (${time}s)\n`;
      
      if (!result.passed && result.error) {
        report += `   Error: ${result.error}\n`;
      }
      
      // Show first few lines of output for context
      if (result.output) {
        const outputLines = result.output.split('\n').slice(0, 3);
        outputLines.forEach(line => {
          if (line.trim()) {
            report += `   ${line.trim()}\n`;
          }
        });
      }
      
      report += '\n';
    }

    return report;
  }
}

/**
 * Batch Fix Validator
 * Validates fixes in batches to handle large codebases
 */
class BatchFixValidator extends FixValidator {
  private batchSize: number;

  constructor(batchSize: number = 50, enabledValidations: string[] = ['typescript', 'eslint']) {
    super(enabledValidations);
    this.batchSize = batchSize;
  }

  /**
   * Validate fixes in batches
   */
  async validateFixesInBatches(files: string[]): Promise<ValidationSummary> {
    console.log(`🔍 Starting batch validation for ${files.length} files...`);
    
    const startTime = Date.now();
    const results: ValidationResult[] = [];
    const batches = this.chunkArray(files, this.batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔍 Validating batch ${i + 1}/${batches.length} (${batch.length} files)`);

      // Validate TypeScript for this batch
      if (this.enabledValidations.includes('typescript')) {
        const tsResult = await this.validateTypeScriptBatch(batch);
        results.push(tsResult);
      }

      // Validate ESLint for this batch
      if (this.enabledValidations.includes('eslint')) {
        const eslintResult = await this.validateESLintBatch(batch);
        results.push(eslintResult);
      }
    }

    const totalTime = Date.now() - startTime;
    const passed = results.every(result => result.passed);

    return {
      passed,
      results,
      totalTime,
      timestamp: new Date()
    };
  }

  /**
   * Validate TypeScript for a batch of files
   */
  private async validateTypeScriptBatch(files: string[]): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Create temporary tsconfig for this batch
      const tempTsConfig = {
        compilerOptions: {
          noEmit: true,
          skipLibCheck: true,
          strict: true
        },
        files: files.map(f => join(this.projectRoot, f))
      };

      const tempConfigPath = join(this.projectRoot, 'tsconfig.temp.json');
      writeFileSync(tempConfigPath, JSON.stringify(tempTsConfig, null, 2));

      const output = execSync(`npx tsc --project ${tempConfigPath}`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      // Clean up temp config
      execSync(`rm -f ${tempConfigPath}`, { cwd: this.projectRoot });

      return {
        type: 'typescript',
        passed: true,
        output: `Batch TypeScript validation successful (${files.length} files)`,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      // Clean up temp config
      const tempConfigPath = join(this.projectRoot, 'tsconfig.temp.json');
      if (existsSync(tempConfigPath)) {
        execSync(`rm -f ${tempConfigPath}`, { cwd: this.projectRoot });
      }

      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      
      return {
        type: 'typescript',
        passed: false,
        output: errorOutput,
        error: `Batch TypeScript validation failed (${files.length} files)`,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate ESLint for a batch of files
   */
  private async validateESLintBatch(files: string[]): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      const output = execSync(`npx eslint ${files.join(' ')} --format compact`, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: 'pipe'
      });

      return {
        type: 'eslint',
        passed: true,
        output: `Batch ESLint validation successful (${files.length} files)`,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      const errorOutput = (error as any).stdout || (error as any).stderr || '';
      const exitCode = (error as any).status;
      const hasOnlyWarnings = exitCode === 1 && !errorOutput.includes('error');
      
      return {
        type: 'eslint',
        passed: hasOnlyWarnings,
        output: errorOutput,
        error: hasOnlyWarnings ? undefined : `Batch ESLint validation failed (${files.length} files)`,
        executionTime: Date.now() - startTime
      };
    }
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
  const batchMode = args.includes('--batch');
  const validations = args.includes('--validations') 
    ? args[args.indexOf('--validations') + 1]?.split(',') || ['typescript', 'eslint']
    : ['typescript', 'eslint', 'tests'];

  try {
    let validator: FixValidator;
    let summary: ValidationSummary;

    if (batchMode) {
      validator = new BatchFixValidator(50, validations);
      // For batch mode, we'd need to pass the files to validate
      // This is a simplified version
      summary = await validator.validateFixes();
    } else {
      validator = new FixValidator(validations);
      summary = await validator.validateFixes();
    }

    const summaryText = validator.generateSummary(summary);
    console.log(summaryText);

    if (summary.passed) {
      console.log('🎉 All validations passed! Your fixes are safe to commit.');
    } else {
      console.log('⚠️  Some validations failed. Please review the issues before committing.');
    }

    process.exit(summary.passed ? 0 : 1);
  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { FixValidator, BatchFixValidator, type ValidationResult, type ValidationSummary };