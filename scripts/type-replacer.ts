#!/usr/bin/env node

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { TypeSafetyAuditor, AnyTypeUsage } from './type-safety-auditor';

interface TypeReplacement {
  file: string;
  line: number;
  column: number;
  oldText: string;
  newText: string;
  confidence: number;
  reasoning: string;
}

interface TypeReplacementResult {
  replacements: TypeReplacement[];
  filesModified: string[];
  totalReplacements: number;
  skippedReplacements: number;
  errors: string[];
}

class TypeReplacer {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(private projectPath: string = '.') {
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

  async replaceAnyTypes(options: {
    dryRun?: boolean;
    maxReplacements?: number;
    priorityFiles?: string[];
    skipFiles?: string[];
    onlyConfident?: boolean;
  } = {}): Promise<TypeReplacementResult> {
    const {
      dryRun = false,
      maxReplacements = 100,
      priorityFiles = [],
      skipFiles = [],
      onlyConfident = true
    } = options;

    const auditor = new TypeSafetyAuditor();
    const report = await auditor.scanForAnyTypes();
    
    const replacements: TypeReplacement[] = [];
    const filesModified = new Set<string>();
    const errors: string[] = [];
    let replacementCount = 0;
    let skippedCount = 0;

    // Sort usages by priority and confidence
    const sortedUsages = this.prioritizeUsages(report.usages, priorityFiles);

    for (const usage of sortedUsages) {
      if (replacementCount >= maxReplacements) break;
      if (skipFiles.some(skipFile => usage.file.includes(skipFile))) {
        skippedCount++;
        continue;
      }

      try {
        const replacement = await this.generateReplacement(usage);
        if (!replacement) {
          skippedCount++;
          continue;
        }

        if (onlyConfident && replacement.confidence < 0.8) {
          skippedCount++;
          continue;
        }

        replacements.push(replacement);
        filesModified.add(replacement.file);
        replacementCount++;

        if (!dryRun) {
          await this.applyReplacement(replacement);
        }
      } catch (error) {
        errors.push(`Error processing ${usage.file}:${usage.line} - ${error}`);
        skippedCount++;
      }
    }

    return {
      replacements,
      filesModified: Array.from(filesModified),
      totalReplacements: replacementCount,
      skippedReplacements: skippedCount,
      errors
    };
  }

  private prioritizeUsages(usages: AnyTypeUsage[], priorityFiles: string[]): AnyTypeUsage[] {
    return usages.sort((a, b) => {
      // Priority files first
      const aIsPriority = priorityFiles.some(file => a.file.includes(file));
      const bIsPriority = priorityFiles.some(file => b.file.includes(file));
      if (aIsPriority && !bIsPriority) return -1;
      if (!aIsPriority && bIsPriority) return 1;

      // Then by severity
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // Then by complexity (simpler first)
      return a.complexity - b.complexity;
    });
  }

  private async generateReplacement(usage: AnyTypeUsage): Promise<TypeReplacement | null> {
    const sourceFile = this.program.getSourceFile(usage.file);
    if (!sourceFile) return null;

    const replacement = this.analyzeAndGenerateReplacement(usage, sourceFile);
    if (!replacement) return null;

    return {
      file: usage.file,
      line: usage.line,
      column: usage.column,
      oldText: replacement.oldText,
      newText: replacement.newText,
      confidence: replacement.confidence,
      reasoning: replacement.reasoning
    };
  }

  private analyzeAndGenerateReplacement(
    usage: AnyTypeUsage, 
    sourceFile: ts.SourceFile
  ): { oldText: string; newText: string; confidence: number; reasoning: string } | null {
    const context = usage.context.toLowerCase();
    
    // High confidence replacements
    if (context.includes('promise<any>')) {
      return {
        oldText: 'Promise<any>',
        newText: 'Promise<unknown>',
        confidence: 0.9,
        reasoning: 'Promise<any> should be Promise<unknown> for type safety'
      };
    }

    if (context.includes('array<any>') || context.includes('any[]')) {
      return {
        oldText: context.includes('Array<any>') ? 'Array<any>' : 'any[]',
        newText: 'unknown[]',
        confidence: 0.85,
        reasoning: 'Generic array should use unknown instead of any'
      };
    }

    if (context.includes('record<string, any>')) {
      return {
        oldText: 'Record<string, any>',
        newText: 'Record<string, unknown>',
        confidence: 0.9,
        reasoning: 'Record values should be unknown instead of any'
      };
    }

    // Medium confidence replacements based on context
    if (context.includes('telegram') || context.includes('message')) {
      if (context.includes('list:') || context.includes('list =')) {
        return {
          oldText: 'any',
          newText: 'KVListResult',
          confidence: 0.8,
          reasoning: 'Telegram KV list operations should use KVListResult type'
        };
      }
      
      if (context.includes('update') || context.includes('webhook')) {
        return {
          oldText: 'any',
          newText: 'TelegramUpdate',
          confidence: 0.85,
          reasoning: 'Telegram updates should use TelegramUpdate type'
        };
      }

      if (context.includes('message') && !context.includes('list')) {
        return {
          oldText: 'any',
          newText: 'TelegramMessage',
          confidence: 0.8,
          reasoning: 'Telegram messages should use TelegramMessage type'
        };
      }
    }

    if (context.includes('openai') || context.includes('ai') || context.includes('completion')) {
      return {
        oldText: 'any',
        newText: 'OpenAIResponse',
        confidence: 0.8,
        reasoning: 'OpenAI responses should use OpenAIResponse type'
      };
    }

    if (context.includes('cloudflare') && context.includes('ai')) {
      return {
        oldText: 'any',
        newText: 'CloudflareAIResponse',
        confidence: 0.8,
        reasoning: 'Cloudflare AI responses should use CloudflareAIResponse type'
      };
    }

    if (context.includes('database') || context.includes('db') || context.includes('query')) {
      if (context.includes('result')) {
        return {
          oldText: 'any',
          newText: 'DatabaseResult',
          confidence: 0.8,
          reasoning: 'Database results should use DatabaseResult type'
        };
      }
      
      if (context.includes('row')) {
        return {
          oldText: 'any',
          newText: 'DatabaseRow',
          confidence: 0.75,
          reasoning: 'Database rows should use DatabaseRow type'
        };
      }
    }

    // Function parameter and return type replacements
    if (usage.nodeType === 'ImplicitAnyParameter') {
      if (context.includes('event') || context.includes('handler')) {
        return {
          oldText: '',
          newText: ': unknown',
          confidence: 0.7,
          reasoning: 'Event handlers should have explicit parameter types'
        };
      }
      
      if (context.includes('callback') || context.includes('cb')) {
        return {
          oldText: '',
          newText: ': (...args: unknown[]) => void',
          confidence: 0.75,
          reasoning: 'Callbacks should have explicit function signatures'
        };
      }
    }

    if (usage.nodeType === 'ImplicitAnyReturn') {
      if (context.includes('async') || context.includes('promise')) {
        return {
          oldText: '',
          newText: ': Promise<unknown>',
          confidence: 0.7,
          reasoning: 'Async functions should have explicit return types'
        };
      }
      
      return {
        oldText: '',
        newText: ': unknown',
        confidence: 0.6,
        reasoning: 'Functions should have explicit return types'
      };
    }

    // Generic object types
    if (context.includes('{}') || context.includes('object')) {
      return {
        oldText: 'any',
        newText: 'Record<string, unknown>',
        confidence: 0.7,
        reasoning: 'Generic objects should use Record<string, unknown>'
      };
    }

    // Configuration and settings
    if (context.includes('config') || context.includes('settings') || context.includes('options')) {
      return {
        oldText: 'any',
        newText: 'Record<string, unknown>',
        confidence: 0.75,
        reasoning: 'Configuration objects should use Record<string, unknown>'
      };
    }

    // Error and exception handling
    if (context.includes('error') || context.includes('exception') || context.includes('catch')) {
      return {
        oldText: 'any',
        newText: 'Error | unknown',
        confidence: 0.8,
        reasoning: 'Error handling should use Error | unknown type'
      };
    }

    // JSON and serialization
    if (context.includes('json') || context.includes('parse') || context.includes('stringify')) {
      return {
        oldText: 'any',
        newText: 'unknown',
        confidence: 0.85,
        reasoning: 'JSON operations should use unknown type'
      };
    }

    // Low confidence fallback
    if (usage.severity === 'info') {
      return {
        oldText: 'any',
        newText: 'unknown',
        confidence: 0.5,
        reasoning: 'Generic fallback to unknown type'
      };
    }

    return null;
  }

  private async applyReplacement(replacement: TypeReplacement): Promise<void> {
    const content = fs.readFileSync(replacement.file, 'utf8');
    const lines = content.split('\n');
    
    if (replacement.line > lines.length) {
      throw new Error(`Line ${replacement.line} does not exist in ${replacement.file}`);
    }

    const line = lines[replacement.line - 1];
    let newLine: string;

    if (replacement.oldText === '') {
      // Adding type annotation
      newLine = line.slice(0, replacement.column - 1) + replacement.newText + line.slice(replacement.column - 1);
    } else {
      // Replacing existing text
      const index = line.indexOf(replacement.oldText);
      if (index === -1) {
        throw new Error(`Could not find "${replacement.oldText}" in line ${replacement.line} of ${replacement.file}`);
      }
      newLine = line.slice(0, index) + replacement.newText + line.slice(index + replacement.oldText.length);
    }

    lines[replacement.line - 1] = newLine;
    const newContent = lines.join('\n');
    
    fs.writeFileSync(replacement.file, newContent, 'utf8');
  }

  async generateReplacementReport(result: TypeReplacementResult, outputPath: string = 'type-replacement-report.md'): Promise<void> {
    let markdown = `# Type Replacement Report\n\n`;
    markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    markdown += `## Summary\n\n`;
    markdown += `- **Total Replacements:** ${result.totalReplacements}\n`;
    markdown += `- **Files Modified:** ${result.filesModified.length}\n`;
    markdown += `- **Skipped Replacements:** ${result.skippedReplacements}\n`;
    markdown += `- **Errors:** ${result.errors.length}\n\n`;

    if (result.filesModified.length > 0) {
      markdown += `## Modified Files\n\n`;
      result.filesModified.forEach(file => {
        const fileReplacements = result.replacements.filter(r => r.file === file);
        markdown += `### ${file}\n\n`;
        markdown += `**Replacements:** ${fileReplacements.length}\n\n`;
        
        fileReplacements.forEach((replacement, index) => {
          markdown += `${index + 1}. **Line ${replacement.line}** (Confidence: ${(replacement.confidence * 100).toFixed(0)}%)\n`;
          markdown += `   - **Old:** \`${replacement.oldText || '(implicit)'}\`\n`;
          markdown += `   - **New:** \`${replacement.newText}\`\n`;
          markdown += `   - **Reasoning:** ${replacement.reasoning}\n\n`;
        });
      });
    }

    if (result.errors.length > 0) {
      markdown += `## Errors\n\n`;
      result.errors.forEach((error, index) => {
        markdown += `${index + 1}. ${error}\n`;
      });
      markdown += `\n`;
    }

    markdown += `## Next Steps\n\n`;
    markdown += `1. **Compile and Test:** Run TypeScript compiler and tests to ensure no breaking changes\n`;
    markdown += `2. **Review Changes:** Manually review all replacements for correctness\n`;
    markdown += `3. **Add Imports:** Add necessary import statements for new types\n`;
    markdown += `4. **Runtime Validation:** Add runtime type guards where needed\n`;
    markdown += `5. **Update Tests:** Update test files to match new type signatures\n\n`;

    fs.writeFileSync(outputPath, markdown);
    console.log(`📄 Type replacement report generated: ${outputPath}`);
  }
}

// CLI interface
async function main() {
  const command = process.argv[2];
  const replacer = new TypeReplacer();

  try {
    switch (command) {
      case 'dry-run':
        console.log('🔍 Running dry-run type replacement...');
        const dryResult = await replacer.replaceAnyTypes({ 
          dryRun: true, 
          maxReplacements: 50,
          onlyConfident: true 
        });
        await replacer.generateReplacementReport(dryResult, 'type-replacement-dry-run.md');
        console.log(`✅ Dry-run complete: ${dryResult.totalReplacements} potential replacements found`);
        break;

      case 'replace':
        const maxReplacements = parseInt(process.argv[3]) || 20;
        console.log(`🔧 Replacing up to ${maxReplacements} 'any' types...`);
        const result = await replacer.replaceAnyTypes({ 
          dryRun: false, 
          maxReplacements,
          onlyConfident: true 
        });
        await replacer.generateReplacementReport(result);
        console.log(`✅ Replacement complete: ${result.totalReplacements} types replaced in ${result.filesModified.length} files`);
        
        if (result.errors.length > 0) {
          console.log(`⚠️  ${result.errors.length} errors occurred during replacement`);
        }
        break;

      case 'priority':
        const priorityFiles = process.argv.slice(3);
        console.log(`🎯 Replacing types in priority files: ${priorityFiles.join(', ')}`);
        const priorityResult = await replacer.replaceAnyTypes({ 
          dryRun: false, 
          maxReplacements: 100,
          priorityFiles,
          onlyConfident: false 
        });
        await replacer.generateReplacementReport(priorityResult, 'type-replacement-priority.md');
        console.log(`✅ Priority replacement complete: ${priorityResult.totalReplacements} types replaced`);
        break;

      default:
        console.log('Usage: npx tsx type-replacer.ts <command> [options]');
        console.log('Commands:');
        console.log('  dry-run              - Preview potential replacements without making changes');
        console.log('  replace [max]        - Replace up to [max] any types (default: 20)');
        console.log('  priority <files...>  - Replace types in specific priority files');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { TypeReplacer };