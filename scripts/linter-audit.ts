#!/usr/bin/env tsx

/**
 * Linter Violation Audit Script
 * Scans codebase for all linter violations and generates comprehensive reports
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

interface LinterViolation {
  /** File path relative to project root */
  filePath: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Rule ID */
  ruleId: string;
  /** Violation message */
  message: string;
  /** Severity level */
  severity: 'error' | 'warning';
  /** Rule category */
  category: 'critical' | 'important' | 'minor';
  /** Whether violation is auto-fixable */
  fixable: boolean;
  /** Source code context */
  sourceContext?: string;
}

interface ViolationSummary {
  /** Total violations */
  totalViolations: number;
  /** Critical violations */
  criticalViolations: number;
  /** Important violations */
  importantViolations: number;
  /** Minor violations */
  minorViolations: number;
  /** Auto-fixable violations */
  fixableViolations: number;
  /** Violations by rule */
  violationsByRule: Record<string, number>;
  /** Violations by file */
  violationsByFile: Record<string, number>;
  /** Most problematic files */
  mostProblematicFiles: Array<{ file: string; violations: number }>;
  /** Most common rules */
  mostCommonRules: Array<{ rule: string; count: number; category: string }>;
}

interface AuditReport {
  /** Report metadata */
  metadata: {
    timestamp: Date;
    projectRoot: string;
    filesScanned: number;
    linterVersion: string;
    configFiles: string[];
  };
  /** Violation summary */
  summary: ViolationSummary;
  /** Detailed violations */
  violations: LinterViolation[];
  /** Fix recommendations */
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    description: string;
    affectedFiles: number;
    estimatedEffort: string;
    autoFixable: boolean;
  }>;
}

/**
 * Linter Audit Tool
 */
class LinterAudit {
  private projectRoot: string;
  private outputDir: string;
  private eslintConfigPath: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.outputDir = join(this.projectRoot, 'reports', 'linter-audit');
    this.eslintConfigPath = join(this.projectRoot, '.eslintrc.js');
  }

  /**
   * Run comprehensive linter audit
   */
  async runAudit(): Promise<AuditReport> {
    console.log('🔍 Starting comprehensive linter audit...');

    // Ensure output directory exists
    this.ensureOutputDirectory();

    // Get all TypeScript and JavaScript files
    const files = await this.getSourceFiles();
    console.log(`📁 Found ${files.length} source files to analyze`);

    // Run ESLint analysis
    const violations = await this.runESLintAnalysis(files);
    console.log(`⚠️  Found ${violations.length} linter violations`);

    // Generate summary
    const summary = this.generateSummary(violations);

    // Generate recommendations
    const recommendations = this.generateRecommendations(violations, summary);

    // Create audit report
    const report: AuditReport = {
      metadata: {
        timestamp: new Date(),
        projectRoot: this.projectRoot,
        filesScanned: files.length,
        linterVersion: this.getESLintVersion(),
        configFiles: this.getConfigFiles()
      },
      summary,
      violations,
      recommendations
    };

    // Save report
    await this.saveReport(report);

    console.log('✅ Linter audit completed successfully');
    return report;
  }

  /**
   * Get all source files to analyze
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

    const excludePatterns = [
      'node_modules/**',
      'dist/**',
      'build/**',
      '**/*.d.ts',
      '**/*.min.js'
    ];

    let files: string[] = [];

    for (const pattern of patterns) {
      const matchedFiles = await glob(pattern, {
        cwd: this.projectRoot,
        ignore: excludePatterns
      });
      files = files.concat(matchedFiles);
    }

    // Remove duplicates and sort
    return [...new Set(files)].sort();
  }

  /**
   * Run ESLint analysis on files
   */
  private async runESLintAnalysis(files: string[]): Promise<LinterViolation[]> {
    const violations: LinterViolation[] = [];

    // Run ESLint in batches to avoid command line length limits
    const batchSize = 50;
    const batches = this.chunkArray(files, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔍 Analyzing batch ${i + 1}/${batches.length} (${batch.length} files)`);

      try {
        const batchViolations = await this.runESLintOnBatch(batch);
        violations.push(...batchViolations);
      } catch (error) {
        console.warn(`⚠️  Failed to analyze batch ${i + 1}:`, error);
      }
    }

    return violations;
  }

  /**
   * Run ESLint on a batch of files
   */
  private async runESLintOnBatch(files: string[]): Promise<LinterViolation[]> {
    const violations: LinterViolation[] = [];

    try {
      // Run ESLint with JSON output
      const command = `npx eslint --format json ${files.join(' ')}`;
      const output = execSync(command, {
        cwd: this.projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Parse ESLint JSON output
      const results = JSON.parse(output);
      
      for (const result of results) {
        const filePath = result.filePath.replace(this.projectRoot + '/', '');
        
        for (const message of result.messages) {
          const violation: LinterViolation = {
            filePath,
            line: message.line,
            column: message.column,
            ruleId: message.ruleId || 'unknown',
            message: message.message,
            severity: message.severity === 2 ? 'error' : 'warning',
            category: this.categorizeRule(message.ruleId),
            fixable: message.fix !== undefined,
            sourceContext: this.getSourceContext(filePath, message.line)
          };

          violations.push(violation);
        }
      }
    } catch (error) {
      // ESLint exits with non-zero code when violations are found
      // Try to parse the output anyway
      const errorOutput = (error as any).stdout;
      if (errorOutput) {
        try {
          const results = JSON.parse(errorOutput);
          
          for (const result of results) {
            const filePath = result.filePath.replace(this.projectRoot + '/', '');
            
            for (const message of result.messages) {
              const violation: LinterViolation = {
                filePath,
                line: message.line,
                column: message.column,
                ruleId: message.ruleId || 'unknown',
                message: message.message,
                severity: message.severity === 2 ? 'error' : 'warning',
                category: this.categorizeRule(message.ruleId),
                fixable: message.fix !== undefined,
                sourceContext: this.getSourceContext(filePath, message.line)
              };

              violations.push(violation);
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse ESLint output:', parseError);
        }
      }
    }

    return violations;
  }

  /**
   * Categorize ESLint rule by severity
   */
  private categorizeRule(ruleId: string): 'critical' | 'important' | 'minor' {
    const criticalRules = [
      '@typescript-eslint/no-explicit-any',
      '@typescript-eslint/no-unused-vars',
      'no-unused-vars',
      '@typescript-eslint/no-unsafe-assignment',
      '@typescript-eslint/no-unsafe-member-access',
      '@typescript-eslint/no-unsafe-call',
      '@typescript-eslint/no-unsafe-return',
      'no-undef',
      'no-unreachable',
      'no-constant-condition',
      'no-dupe-keys',
      'no-duplicate-case'
    ];

    const importantRules = [
      '@typescript-eslint/prefer-const',
      '@typescript-eslint/no-inferrable-types',
      'prefer-const',
      'no-var',
      'eqeqeq',
      'no-console',
      '@typescript-eslint/no-empty-function',
      'no-empty',
      '@typescript-eslint/ban-ts-comment'
    ];

    if (criticalRules.includes(ruleId)) {
      return 'critical';
    } else if (importantRules.includes(ruleId)) {
      return 'important';
    } else {
      return 'minor';
    }
  }

  /**
   * Get source code context for a violation
   */
  private getSourceContext(filePath: string, line: number): string {
    try {
      const fullPath = join(this.projectRoot, filePath);
      if (!existsSync(fullPath)) {
        return '';
      }

      const content = readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      
      // Get 2 lines before and after for context
      const startLine = Math.max(0, line - 3);
      const endLine = Math.min(lines.length - 1, line + 1);
      
      const contextLines = lines.slice(startLine, endLine + 1);
      return contextLines.join('\n');
    } catch (error) {
      return '';
    }
  }

  /**
   * Generate violation summary
   */
  private generateSummary(violations: LinterViolation[]): ViolationSummary {
    const violationsByRule: Record<string, number> = {};
    const violationsByFile: Record<string, number> = {};
    
    let criticalViolations = 0;
    let importantViolations = 0;
    let minorViolations = 0;
    let fixableViolations = 0;

    for (const violation of violations) {
      // Count by rule
      violationsByRule[violation.ruleId] = (violationsByRule[violation.ruleId] || 0) + 1;
      
      // Count by file
      violationsByFile[violation.filePath] = (violationsByFile[violation.filePath] || 0) + 1;
      
      // Count by category
      switch (violation.category) {
        case 'critical':
          criticalViolations++;
          break;
        case 'important':
          importantViolations++;
          break;
        case 'minor':
          minorViolations++;
          break;
      }
      
      // Count fixable
      if (violation.fixable) {
        fixableViolations++;
      }
    }

    // Get most problematic files
    const mostProblematicFiles = Object.entries(violationsByFile)
      .map(([file, violations]) => ({ file, violations }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 10);

    // Get most common rules
    const mostCommonRules = Object.entries(violationsByRule)
      .map(([rule, count]) => ({
        rule,
        count,
        category: this.categorizeRule(rule)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return {
      totalViolations: violations.length,
      criticalViolations,
      importantViolations,
      minorViolations,
      fixableViolations,
      violationsByRule,
      violationsByFile,
      mostProblematicFiles,
      mostCommonRules
    };
  }

  /**
   * Generate fix recommendations
   */
  private generateRecommendations(
    violations: LinterViolation[],
    summary: ViolationSummary
  ): AuditReport['recommendations'] {
    const recommendations: AuditReport['recommendations'] = [];

    // Critical violations recommendations
    if (summary.criticalViolations > 0) {
      recommendations.push({
        priority: 'high',
        description: `Fix ${summary.criticalViolations} critical violations that can cause runtime errors or type safety issues`,
        affectedFiles: Object.keys(summary.violationsByFile).length,
        estimatedEffort: this.estimateEffort(summary.criticalViolations),
        autoFixable: violations.filter(v => v.category === 'critical' && v.fixable).length > 0
      });
    }

    // Unused variables recommendation
    const unusedVarViolations = violations.filter(v => 
      v.ruleId.includes('no-unused-vars') || v.ruleId.includes('unused-vars')
    );
    
    if (unusedVarViolations.length > 0) {
      recommendations.push({
        priority: 'high',
        description: `Fix ${unusedVarViolations.length} unused variable violations by prefixing with underscore or removing`,
        affectedFiles: new Set(unusedVarViolations.map(v => v.filePath)).size,
        estimatedEffort: this.estimateEffort(unusedVarViolations.length),
        autoFixable: true
      });
    }

    // 'any' type recommendations
    const anyTypeViolations = violations.filter(v => 
      v.ruleId.includes('no-explicit-any') || v.ruleId.includes('no-unsafe')
    );
    
    if (anyTypeViolations.length > 0) {
      recommendations.push({
        priority: 'high',
        description: `Replace ${anyTypeViolations.length} 'any' type usages with proper type definitions`,
        affectedFiles: new Set(anyTypeViolations.map(v => v.filePath)).size,
        estimatedEffort: this.estimateEffort(anyTypeViolations.length * 2), // More effort for type definitions
        autoFixable: false
      });
    }

    // Auto-fixable recommendations
    if (summary.fixableViolations > 0) {
      recommendations.push({
        priority: 'medium',
        description: `Auto-fix ${summary.fixableViolations} violations using ESLint --fix`,
        affectedFiles: Object.keys(summary.violationsByFile).length,
        estimatedEffort: '1-2 hours',
        autoFixable: true
      });
    }

    // Configuration recommendations
    recommendations.push({
      priority: 'medium',
      description: 'Update ESLint configuration to prevent future violations',
      affectedFiles: 1,
      estimatedEffort: '2-4 hours',
      autoFixable: false
    });

    // Pre-commit hooks recommendation
    recommendations.push({
      priority: 'medium',
      description: 'Configure pre-commit hooks to catch violations before commit',
      affectedFiles: 1,
      estimatedEffort: '1-2 hours',
      autoFixable: false
    });

    return recommendations;
  }

  /**
   * Estimate effort based on violation count
   */
  private estimateEffort(violationCount: number): string {
    if (violationCount <= 10) {
      return '1-2 hours';
    } else if (violationCount <= 50) {
      return '4-8 hours';
    } else if (violationCount <= 100) {
      return '1-2 days';
    } else if (violationCount <= 200) {
      return '2-4 days';
    } else {
      return '1+ weeks';
    }
  }

  /**
   * Get ESLint version
   */
  private getESLintVersion(): string {
    try {
      const output = execSync('npx eslint --version', {
        cwd: this.projectRoot,
        encoding: 'utf8'
      });
      return output.trim();
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Get configuration files
   */
  private getConfigFiles(): string[] {
    const configFiles = [
      '.eslintrc.js',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js',
      'package.json'
    ];

    return configFiles.filter(file => 
      existsSync(join(this.projectRoot, file))
    );
  }

  /**
   * Ensure output directory exists
   */
  private ensureOutputDirectory(): void {
    const { execSync } = require('child_process');
    execSync(`mkdir -p "${this.outputDir}"`, { cwd: this.projectRoot });
  }

  /**
   * Save audit report
   */
  private async saveReport(report: AuditReport): Promise<void> {
    const timestamp = report.metadata.timestamp.toISOString().replace(/[:.]/g, '-');
    
    // Save JSON report
    const jsonPath = join(this.outputDir, `linter-audit-${timestamp}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`📄 JSON report saved: ${jsonPath}`);

    // Save HTML report
    const htmlPath = join(this.outputDir, `linter-audit-${timestamp}.html`);
    const htmlContent = this.generateHTMLReport(report);
    writeFileSync(htmlPath, htmlContent);
    console.log(`📄 HTML report saved: ${htmlPath}`);

    // Save CSV report for violations
    const csvPath = join(this.outputDir, `linter-violations-${timestamp}.csv`);
    const csvContent = this.generateCSVReport(report.violations);
    writeFileSync(csvPath, csvContent);
    console.log(`📄 CSV report saved: ${csvPath}`);

    // Save latest report (overwrite)
    const latestJsonPath = join(this.outputDir, 'latest-audit.json');
    writeFileSync(latestJsonPath, JSON.stringify(report, null, 2));
    console.log(`📄 Latest report saved: ${latestJsonPath}`);
  }

  /**
   * Generate HTML report
   */
  private generateHTMLReport(report: AuditReport): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Linter Audit Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 2.5em; }
        .header p { margin: 10px 0 0 0; opacity: 0.9; }
        .content { padding: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007bff; }
        .stat-card.critical { border-left-color: #dc3545; }
        .stat-card.important { border-left-color: #fd7e14; }
        .stat-card.minor { border-left-color: #28a745; }
        .stat-card.fixable { border-left-color: #17a2b8; }
        .stat-number { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .stat-label { color: #6c757d; font-size: 0.9em; }
        .section { margin-bottom: 40px; }
        .section h2 { color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
        .table th { background: #f8f9fa; font-weight: 600; }
        .table tr:hover { background: #f8f9fa; }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 500; }
        .badge.critical { background: #f8d7da; color: #721c24; }
        .badge.important { background: #ffeaa7; color: #856404; }
        .badge.minor { background: #d4edda; color: #155724; }
        .badge.error { background: #f8d7da; color: #721c24; }
        .badge.warning { background: #fff3cd; color: #856404; }
        .recommendations { background: #e7f3ff; padding: 20px; border-radius: 8px; border-left: 4px solid #007bff; }
        .recommendation { margin-bottom: 15px; padding: 15px; background: white; border-radius: 6px; }
        .recommendation h4 { margin: 0 0 8px 0; color: #333; }
        .recommendation p { margin: 0; color: #666; }
        .priority-high { border-left: 4px solid #dc3545; }
        .priority-medium { border-left: 4px solid #fd7e14; }
        .priority-low { border-left: 4px solid #28a745; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Linter Audit Report</h1>
            <p>Generated on ${report.metadata.timestamp.toLocaleString()}</p>
            <p>Scanned ${report.metadata.filesScanned} files • Found ${report.summary.totalViolations} violations</p>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>📊 Summary</h2>
                <div class="summary">
                    <div class="stat-card critical">
                        <div class="stat-number">${report.summary.criticalViolations}</div>
                        <div class="stat-label">Critical Violations</div>
                    </div>
                    <div class="stat-card important">
                        <div class="stat-number">${report.summary.importantViolations}</div>
                        <div class="stat-label">Important Violations</div>
                    </div>
                    <div class="stat-card minor">
                        <div class="stat-number">${report.summary.minorViolations}</div>
                        <div class="stat-label">Minor Violations</div>
                    </div>
                    <div class="stat-card fixable">
                        <div class="stat-number">${report.summary.fixableViolations}</div>
                        <div class="stat-label">Auto-fixable</div>
                    </div>
                </div>
            </div>

            <div class="section">
                <h2>🎯 Most Common Rules</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Rule</th>
                            <th>Count</th>
                            <th>Category</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${report.summary.mostCommonRules.map(rule => `
                            <tr>
                                <td><code>${rule.rule}</code></td>
                                <td>${rule.count}</td>
                                <td><span class="badge ${rule.category}">${rule.category}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>📁 Most Problematic Files</h2>
                <table class="table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Violations</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${report.summary.mostProblematicFiles.map(file => `
                            <tr>
                                <td><code>${file.file}</code></td>
                                <td>${file.violations}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <div class="section">
                <h2>💡 Recommendations</h2>
                <div class="recommendations">
                    ${report.recommendations.map(rec => `
                        <div class="recommendation priority-${rec.priority}">
                            <h4>${rec.description}</h4>
                            <p><strong>Priority:</strong> ${rec.priority} | <strong>Affected Files:</strong> ${rec.affectedFiles} | <strong>Estimated Effort:</strong> ${rec.estimatedEffort} | <strong>Auto-fixable:</strong> ${rec.autoFixable ? 'Yes' : 'No'}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * Generate CSV report
   */
  private generateCSVReport(violations: LinterViolation[]): string {
    const headers = ['File', 'Line', 'Column', 'Rule', 'Message', 'Severity', 'Category', 'Fixable'];
    const rows = violations.map(v => [
      v.filePath,
      v.line.toString(),
      v.column.toString(),
      v.ruleId,
      `"${v.message.replace(/"/g, '""')}"`,
      v.severity,
      v.category,
      v.fixable ? 'Yes' : 'No'
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
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
  try {
    const audit = new LinterAudit();
    const report = await audit.runAudit();
    
    console.log('\n📊 Audit Summary:');
    console.log(`   Total violations: ${report.summary.totalViolations}`);
    console.log(`   Critical: ${report.summary.criticalViolations}`);
    console.log(`   Important: ${report.summary.importantViolations}`);
    console.log(`   Minor: ${report.summary.minorViolations}`);
    console.log(`   Auto-fixable: ${report.summary.fixableViolations}`);
    
    console.log('\n🎯 Top 5 Most Common Rules:');
    report.summary.mostCommonRules.slice(0, 5).forEach((rule, index) => {
      console.log(`   ${index + 1}. ${rule.rule} (${rule.count} violations, ${rule.category})`);
    });
    
    console.log('\n💡 Priority Recommendations:');
    report.recommendations.filter(r => r.priority === 'high').forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec.description}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { LinterAudit, type AuditReport, type LinterViolation };