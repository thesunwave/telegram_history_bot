#!/usr/bin/env node

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface AnyTypeUsage {
  file: string;
  line: number;
  column: number;
  context: string;
  nodeType: string;
  severity: 'critical' | 'warning' | 'info';
  complexity: number;
  suggestion: string;
}

interface TypeUsageReport {
  totalUsages: number;
  fileBreakdown: Record<string, number>;
  severityBreakdown: Record<string, number>;
  usages: AnyTypeUsage[];
  priorityOrder: string[];
  summary: string;
}

class TypeSafetyAuditor {
  private sourceFiles: ts.SourceFile[] = [];
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(private projectPath: string = '.') {
    // Create TypeScript program
    const configPath = ts.findConfigFile(projectPath, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      throw new Error('Could not find tsconfig.json');
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const compilerOptions = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath)
    );

    this.program = ts.createProgram(compilerOptions.fileNames, compilerOptions.options);
    this.checker = this.program.getTypeChecker();
  }

  async scanForAnyTypes(): Promise<TypeUsageReport> {
    const usages: AnyTypeUsage[] = [];
    const fileBreakdown: Record<string, number> = {};
    const severityBreakdown: Record<string, number> = { critical: 0, warning: 0, info: 0 };

    // Get all TypeScript files
    const tsFiles = await glob('src/**/*.ts', { 
      ignore: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts', 'node_modules/**']
    });

    for (const filePath of tsFiles) {
      const sourceFile = this.program.getSourceFile(filePath);
      if (!sourceFile) continue;

      const fileUsages = this.scanSourceFile(sourceFile);
      usages.push(...fileUsages);
      
      if (fileUsages.length > 0) {
        fileBreakdown[filePath] = fileUsages.length;
        fileUsages.forEach(usage => severityBreakdown[usage.severity]++);
      }
    }

    // Sort files by priority (most critical first)
    const priorityOrder = Object.entries(fileBreakdown)
      .sort(([, a], [, b]) => b - a)
      .map(([file]) => file);

    const report: TypeUsageReport = {
      totalUsages: usages.length,
      fileBreakdown,
      severityBreakdown,
      usages: usages.sort((a, b) => {
        // Sort by severity first, then by complexity
        const severityOrder = { critical: 3, warning: 2, info: 1 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[b.severity] - severityOrder[a.severity];
        }
        return b.complexity - a.complexity;
      }),
      priorityOrder,
      summary: this.generateSummary(usages.length, severityBreakdown, fileBreakdown)
    };

    return report;
  }

  private scanSourceFile(sourceFile: ts.SourceFile): AnyTypeUsage[] {
    const usages: AnyTypeUsage[] = [];

    const visit = (node: ts.Node) => {
      // Check for explicit 'any' type annotations
      if (ts.isTypeReferenceNode(node) && node.typeName.getText() === 'any') {
        usages.push(this.createUsage(node, sourceFile, 'TypeReference', 'critical'));
      }
      
      // Check for 'any' in type literals
      if (node.kind === ts.SyntaxKind.AnyKeyword) {
        usages.push(this.createUsage(node, sourceFile, 'AnyKeyword', this.getSeverity(node)));
      }

      // Check for function parameters without types (implicit any)
      if (ts.isParameter(node) && !node.type && !node.initializer) {
        const parent = node.parent;
        if (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isArrowFunction(parent)) {
          usages.push(this.createUsage(node, sourceFile, 'ImplicitAnyParameter', 'warning'));
        }
      }

      // Check for variables without type annotations that could be any
      if (ts.isVariableDeclaration(node) && !node.type && !node.initializer) {
        usages.push(this.createUsage(node, sourceFile, 'ImplicitAnyVariable', 'info'));
      }

      // Check for return types that could be any
      if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && !node.type) {
        const signature = this.checker.getSignatureFromDeclaration(node);
        if (signature) {
          const returnType = this.checker.getReturnTypeOfSignature(signature);
          if (returnType.flags & ts.TypeFlags.Any) {
            usages.push(this.createUsage(node, sourceFile, 'ImplicitAnyReturn', 'warning'));
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return usages;
  }

  private createUsage(node: ts.Node, sourceFile: ts.SourceFile, nodeType: string, severity: 'critical' | 'warning' | 'info'): AnyTypeUsage {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const context = this.getContext(node, sourceFile);
    
    return {
      file: sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      context,
      nodeType,
      severity,
      complexity: this.calculateComplexity(node, context),
      suggestion: this.generateSuggestion(nodeType, context)
    };
  }

  private getSeverity(node: ts.Node): 'critical' | 'warning' | 'info' {
    const parent = node.parent;
    
    // Critical: Public API interfaces, exported functions
    if (this.isPublicAPI(node)) {
      return 'critical';
    }
    
    // Warning: Function parameters, return types
    if (ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) {
      return 'warning';
    }
    
    // Info: Local variables, private members
    return 'info';
  }

  private isPublicAPI(node: ts.Node): boolean {
    let current = node.parent;
    while (current) {
      if (ts.isInterfaceDeclaration(current) || ts.isTypeAliasDeclaration(current)) {
        return this.hasExportModifier(current);
      }
      if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) {
        return this.hasExportModifier(current);
      }
      current = current.parent;
    }
    return false;
  }

  private hasExportModifier(node: ts.Node): boolean {
    if (!node.modifiers) return false;
    return node.modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  }

  private getContext(node: ts.Node, sourceFile: ts.SourceFile): string {
    const start = Math.max(0, node.getStart() - 50);
    const end = Math.min(sourceFile.getFullText().length, node.getEnd() + 50);
    return sourceFile.getFullText().substring(start, end).trim();
  }

  private calculateComplexity(node: ts.Node, context: string): number {
    let complexity = 1;
    
    // Higher complexity for nested structures
    let parent = node.parent;
    let depth = 0;
    while (parent && depth < 10) {
      if (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || 
          ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) {
        complexity += 1;
      }
      parent = parent.parent;
      depth++;
    }
    
    // Higher complexity for generic contexts
    if (context.includes('<') && context.includes('>')) {
      complexity += 2;
    }
    
    // Higher complexity for union/intersection types
    if (context.includes('|') || context.includes('&')) {
      complexity += 1;
    }
    
    return complexity;
  }

  private generateSuggestion(nodeType: string, context: string): string {
    switch (nodeType) {
      case 'TypeReference':
      case 'AnyKeyword':
        if (context.includes('Promise')) {
          return 'Replace with specific Promise type: Promise<YourType>';
        }
        if (context.includes('Array') || context.includes('[]')) {
          return 'Replace with typed array: YourType[]';
        }
        if (context.includes('Record') || context.includes('{}')) {
          return 'Replace with specific object type or interface';
        }
        return 'Replace with specific type based on usage';
      
      case 'ImplicitAnyParameter':
        return 'Add explicit type annotation to parameter';
      
      case 'ImplicitAnyVariable':
        return 'Add type annotation or initializer to variable';
      
      case 'ImplicitAnyReturn':
        return 'Add explicit return type annotation';
      
      default:
        return 'Consider adding explicit type annotation';
    }
  }

  private generateSummary(totalUsages: number, severityBreakdown: Record<string, number>, fileBreakdown: Record<string, number>): string {
    const fileCount = Object.keys(fileBreakdown).length;
    const avgUsagesPerFile = fileCount > 0 ? (totalUsages / fileCount).toFixed(1) : '0';
    
    return `Found ${totalUsages} 'any' type usages across ${fileCount} files (avg: ${avgUsagesPerFile} per file). ` +
           `Critical: ${severityBreakdown.critical}, Warning: ${severityBreakdown.warning}, Info: ${severityBreakdown.info}. ` +
           `Priority should be given to critical issues in public APIs and exported functions.`;
  }

  async generateReport(outputPath: string = 'type-safety-audit-report.json'): Promise<void> {
    const report = await this.scanForAnyTypes();
    
    // Write detailed JSON report
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    
    // Write human-readable summary
    const summaryPath = outputPath.replace('.json', '-summary.md');
    const summaryContent = this.generateMarkdownSummary(report);
    fs.writeFileSync(summaryPath, summaryContent);
    
    console.log(`✅ Type safety audit complete!`);
    console.log(`📊 ${report.summary}`);
    console.log(`📄 Detailed report: ${outputPath}`);
    console.log(`📋 Summary report: ${summaryPath}`);
  }

  private generateMarkdownSummary(report: TypeUsageReport): string {
    const { totalUsages, severityBreakdown, fileBreakdown, priorityOrder } = report;
    
    let markdown = `# Type Safety Audit Report\n\n`;
    markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
    markdown += `## Summary\n\n${report.summary}\n\n`;
    
    markdown += `## Severity Breakdown\n\n`;
    markdown += `| Severity | Count | Percentage |\n`;
    markdown += `|----------|-------|------------|\n`;
    Object.entries(severityBreakdown).forEach(([severity, count]) => {
      const percentage = totalUsages > 0 ? ((count / totalUsages) * 100).toFixed(1) : '0';
      markdown += `| ${severity.charAt(0).toUpperCase() + severity.slice(1)} | ${count} | ${percentage}% |\n`;
    });
    
    markdown += `\n## Files by Priority\n\n`;
    markdown += `| File | Usage Count | Priority |\n`;
    markdown += `|------|-------------|----------|\n`;
    priorityOrder.slice(0, 10).forEach((file, index) => {
      const count = fileBreakdown[file];
      const priority = index < 3 ? 'High' : index < 7 ? 'Medium' : 'Low';
      markdown += `| ${file} | ${count} | ${priority} |\n`;
    });
    
    if (priorityOrder.length > 10) {
      markdown += `\n*... and ${priorityOrder.length - 10} more files*\n`;
    }
    
    markdown += `\n## Critical Issues (Top 10)\n\n`;
    const criticalIssues = report.usages.filter(u => u.severity === 'critical').slice(0, 10);
    if (criticalIssues.length > 0) {
      criticalIssues.forEach((usage, index) => {
        markdown += `### ${index + 1}. ${path.basename(usage.file)}:${usage.line}\n\n`;
        markdown += `**Type:** ${usage.nodeType}  \n`;
        markdown += `**Complexity:** ${usage.complexity}  \n`;
        markdown += `**Suggestion:** ${usage.suggestion}  \n\n`;
        markdown += `\`\`\`typescript\n${usage.context}\n\`\`\`\n\n`;
      });
    } else {
      markdown += `No critical issues found! 🎉\n\n`;
    }
    
    markdown += `## Recommendations\n\n`;
    markdown += `1. **Start with Critical Issues**: Focus on public APIs and exported functions first\n`;
    markdown += `2. **File-by-File Approach**: Work through files in priority order\n`;
    markdown += `3. **Test Coverage**: Ensure tests exist before making type changes\n`;
    markdown += `4. **Incremental Changes**: Make small, focused changes to avoid breaking functionality\n`;
    markdown += `5. **Runtime Validation**: Add type guards for external data sources\n\n`;
    
    return markdown;
  }
}

// CLI interface
async function main() {
  try {
    const auditor = new TypeSafetyAuditor();
    await auditor.generateReport();
  } catch (error) {
    console.error('❌ Type safety audit failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { TypeSafetyAuditor, AnyTypeUsage, TypeUsageReport };