#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { TypeSafetyAuditor, TypeUsageReport } from './type-safety-auditor';

interface TypeImprovementProgress {
  timestamp: string;
  totalUsages: number;
  criticalUsages: number;
  warningUsages: number;
  infoUsages: number;
  filesWithIssues: number;
  completedFiles: string[];
  inProgressFiles: string[];
  targetDate?: string;
  milestones: TypeImprovementMilestone[];
}

interface TypeImprovementMilestone {
  name: string;
  description: string;
  targetUsages: number;
  targetDate: string;
  completed: boolean;
  completedDate?: string;
}

interface TypeImprovementPlan {
  phases: TypeImprovementPhase[];
  estimatedDuration: string;
  riskAssessment: string[];
  dependencies: string[];
}

interface TypeImprovementPhase {
  name: string;
  description: string;
  files: string[];
  estimatedEffort: string;
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];
  risks: string[];
}

class TypeImprovementTracker {
  private progressFile = 'type-improvement-progress.json';
  private planFile = 'type-improvement-plan.json';

  async initializeTracking(): Promise<void> {
    const auditor = new TypeSafetyAuditor();
    const report = await auditor.scanForAnyTypes();
    
    const initialProgress: TypeImprovementProgress = {
      timestamp: new Date().toISOString(),
      totalUsages: report.totalUsages,
      criticalUsages: report.severityBreakdown.critical || 0,
      warningUsages: report.severityBreakdown.warning || 0,
      infoUsages: report.severityBreakdown.info || 0,
      filesWithIssues: Object.keys(report.fileBreakdown).length,
      completedFiles: [],
      inProgressFiles: [],
      milestones: this.createMilestones(report)
    };

    const plan = this.createImprovementPlan(report);

    fs.writeFileSync(this.progressFile, JSON.stringify(initialProgress, null, 2));
    fs.writeFileSync(this.planFile, JSON.stringify(plan, null, 2));

    console.log('✅ Type improvement tracking initialized');
    console.log(`📊 Baseline: ${report.totalUsages} total usages across ${Object.keys(report.fileBreakdown).length} files`);
    console.log(`📋 Plan created with ${plan.phases.length} phases`);
  }

  async updateProgress(): Promise<void> {
    const auditor = new TypeSafetyAuditor();
    const currentReport = await auditor.scanForAnyTypes();
    
    let progress: TypeImprovementProgress;
    if (fs.existsSync(this.progressFile)) {
      progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
    } else {
      throw new Error('Progress tracking not initialized. Run initializeTracking() first.');
    }

    const previousTotal = progress.totalUsages;
    const improvement = previousTotal - currentReport.totalUsages;
    const improvementPercentage = previousTotal > 0 ? ((improvement / previousTotal) * 100).toFixed(1) : '0';

    // Update progress
    progress.timestamp = new Date().toISOString();
    progress.totalUsages = currentReport.totalUsages;
    progress.criticalUsages = currentReport.severityBreakdown.critical || 0;
    progress.warningUsages = currentReport.severityBreakdown.warning || 0;
    progress.infoUsages = currentReport.severityBreakdown.info || 0;
    progress.filesWithIssues = Object.keys(currentReport.fileBreakdown).length;

    // Update milestones
    progress.milestones = progress.milestones.map(milestone => {
      if (!milestone.completed && currentReport.totalUsages <= milestone.targetUsages) {
        milestone.completed = true;
        milestone.completedDate = new Date().toISOString();
      }
      return milestone;
    });

    fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));

    console.log('📈 Progress updated:');
    console.log(`   Total usages: ${currentReport.totalUsages} (${improvement >= 0 ? '-' : '+'}${Math.abs(improvement)}, ${improvementPercentage}% improvement)`);
    console.log(`   Critical: ${progress.criticalUsages}, Warning: ${progress.warningUsages}, Info: ${progress.infoUsages}`);
    
    const completedMilestones = progress.milestones.filter(m => m.completed).length;
    console.log(`🎯 Milestones: ${completedMilestones}/${progress.milestones.length} completed`);
  }

  async generateProgressReport(): Promise<void> {
    if (!fs.existsSync(this.progressFile)) {
      throw new Error('Progress tracking not initialized. Run initializeTracking() first.');
    }

    const progress: TypeImprovementProgress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
    const plan: TypeImprovementPlan = JSON.parse(fs.readFileSync(this.planFile, 'utf8'));

    const reportContent = this.generateProgressMarkdown(progress, plan);
    const reportPath = 'type-improvement-progress-report.md';
    
    fs.writeFileSync(reportPath, reportContent);
    console.log(`📄 Progress report generated: ${reportPath}`);
  }

  private createMilestones(report: TypeUsageReport): TypeImprovementMilestone[] {
    const total = report.totalUsages;
    const critical = report.severityBreakdown.critical || 0;
    
    return [
      {
        name: 'Critical Issues Resolved',
        description: 'All critical type issues in public APIs resolved',
        targetUsages: total - critical,
        targetDate: this.addDays(new Date(), 14).toISOString(),
        completed: false
      },
      {
        name: '50% Reduction',
        description: 'Reduced total any usages by 50%',
        targetUsages: Math.floor(total * 0.5),
        targetDate: this.addDays(new Date(), 30).toISOString(),
        completed: false
      },
      {
        name: '80% Reduction',
        description: 'Reduced total any usages by 80%',
        targetUsages: Math.floor(total * 0.2),
        targetDate: this.addDays(new Date(), 60).toISOString(),
        completed: false
      },
      {
        name: 'Type Safety Complete',
        description: 'All any types replaced with concrete types',
        targetUsages: 0,
        targetDate: this.addDays(new Date(), 90).toISOString(),
        completed: false
      }
    ];
  }

  private createImprovementPlan(report: TypeUsageReport): TypeImprovementPlan {
    const highPriorityFiles = report.priorityOrder.slice(0, 10);
    const mediumPriorityFiles = report.priorityOrder.slice(10, 30);
    const lowPriorityFiles = report.priorityOrder.slice(30);

    const phases: TypeImprovementPhase[] = [
      {
        name: 'Phase 1: Critical API Types',
        description: 'Fix critical type issues in public APIs and exported functions',
        files: highPriorityFiles.filter(file => 
          report.usages.some(u => u.file === file && u.severity === 'critical')
        ),
        estimatedEffort: '2-3 weeks',
        priority: 'high',
        dependencies: ['Test coverage verification'],
        risks: ['Breaking changes to public APIs', 'Integration test failures']
      },
      {
        name: 'Phase 2: Core Utilities',
        description: 'Replace any types in utility functions and shared modules',
        files: highPriorityFiles,
        estimatedEffort: '2-3 weeks',
        priority: 'high',
        dependencies: ['Phase 1 completion', 'Runtime validation system'],
        risks: ['Cascading type errors', 'Performance impact']
      },
      {
        name: 'Phase 3: Service Layer',
        description: 'Improve type safety in service layer and business logic',
        files: mediumPriorityFiles,
        estimatedEffort: '3-4 weeks',
        priority: 'medium',
        dependencies: ['Phase 2 completion'],
        risks: ['Complex generic constraints', 'Database type mismatches']
      },
      {
        name: 'Phase 4: Remaining Files',
        description: 'Complete type safety improvements in remaining files',
        files: lowPriorityFiles,
        estimatedEffort: '2-3 weeks',
        priority: 'low',
        dependencies: ['Phase 3 completion'],
        risks: ['Legacy code compatibility', 'Test maintenance overhead']
      }
    ];

    return {
      phases,
      estimatedDuration: '9-13 weeks',
      riskAssessment: [
        'Breaking changes may require API versioning',
        'Complex generic types may impact compilation time',
        'Runtime validation may affect performance',
        'Large refactoring may introduce bugs'
      ],
      dependencies: [
        'Comprehensive test suite',
        'Runtime type validation system',
        'Type guard utilities',
        'Migration testing strategy'
      ]
    };
  }

  private generateProgressMarkdown(progress: TypeImprovementProgress, plan: TypeImprovementPlan): string {
    let markdown = `# Type Safety Improvement Progress Report\n\n`;
    markdown += `**Last Updated:** ${new Date(progress.timestamp).toLocaleString()}\n\n`;

    // Current Status
    markdown += `## Current Status\n\n`;
    markdown += `| Metric | Count |\n`;
    markdown += `|--------|-------|\n`;
    markdown += `| Total 'any' usages | ${progress.totalUsages} |\n`;
    markdown += `| Critical issues | ${progress.criticalUsages} |\n`;
    markdown += `| Warning issues | ${progress.warningUsages} |\n`;
    markdown += `| Info issues | ${progress.infoUsages} |\n`;
    markdown += `| Files with issues | ${progress.filesWithIssues} |\n`;
    markdown += `| Completed files | ${progress.completedFiles.length} |\n`;
    markdown += `| In progress files | ${progress.inProgressFiles.length} |\n\n`;

    // Milestones
    markdown += `## Milestones\n\n`;
    progress.milestones.forEach((milestone, index) => {
      const status = milestone.completed ? '✅' : '⏳';
      const completedText = milestone.completed ? ` (Completed: ${new Date(milestone.completedDate!).toLocaleDateString()})` : '';
      markdown += `${index + 1}. ${status} **${milestone.name}**${completedText}\n`;
      markdown += `   - ${milestone.description}\n`;
      markdown += `   - Target: ≤${milestone.targetUsages} usages by ${new Date(milestone.targetDate).toLocaleDateString()}\n\n`;
    });

    // Implementation Plan
    markdown += `## Implementation Plan\n\n`;
    markdown += `**Estimated Duration:** ${plan.estimatedDuration}\n\n`;
    
    plan.phases.forEach((phase, index) => {
      markdown += `### ${phase.name}\n\n`;
      markdown += `**Description:** ${phase.description}\n`;
      markdown += `**Priority:** ${phase.priority.toUpperCase()}\n`;
      markdown += `**Estimated Effort:** ${phase.estimatedEffort}\n`;
      markdown += `**Files:** ${phase.files.length} files\n\n`;
      
      if (phase.dependencies.length > 0) {
        markdown += `**Dependencies:**\n`;
        phase.dependencies.forEach(dep => markdown += `- ${dep}\n`);
        markdown += `\n`;
      }
      
      if (phase.risks.length > 0) {
        markdown += `**Risks:**\n`;
        phase.risks.forEach(risk => markdown += `- ${risk}\n`);
        markdown += `\n`;
      }
    });

    // Risk Assessment
    markdown += `## Risk Assessment\n\n`;
    plan.riskAssessment.forEach(risk => markdown += `- ${risk}\n`);
    markdown += `\n`;

    // Dependencies
    markdown += `## Dependencies\n\n`;
    plan.dependencies.forEach(dep => markdown += `- ${dep}\n`);
    markdown += `\n`;

    // Next Steps
    markdown += `## Next Steps\n\n`;
    const nextMilestone = progress.milestones.find(m => !m.completed);
    if (nextMilestone) {
      markdown += `1. **Focus on:** ${nextMilestone.name}\n`;
      markdown += `2. **Target:** ${nextMilestone.description}\n`;
      markdown += `3. **Deadline:** ${new Date(nextMilestone.targetDate).toLocaleDateString()}\n`;
    } else {
      markdown += `🎉 All milestones completed! Type safety improvement is complete.\n`;
    }

    return markdown;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}

// CLI interface
async function main() {
  const tracker = new TypeImprovementTracker();
  const command = process.argv[2];

  try {
    switch (command) {
      case 'init':
        await tracker.initializeTracking();
        break;
      case 'update':
        await tracker.updateProgress();
        break;
      case 'report':
        await tracker.generateProgressReport();
        break;
      default:
        console.log('Usage: npx tsx type-improvement-tracker.ts <command>');
        console.log('Commands:');
        console.log('  init   - Initialize progress tracking');
        console.log('  update - Update progress with current audit');
        console.log('  report - Generate progress report');
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

export { TypeImprovementTracker };