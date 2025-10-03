#!/usr/bin/env tsx

/**
 * Fix Plan Generator
 * Creates prioritized fixing plan based on linter audit results
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AuditReport, LinterViolation } from './linter-audit';

interface FixTask {
  /** Task ID */
  id: string;
  /** Task title */
  title: string;
  /** Task description */
  description: string;
  /** Priority level */
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Estimated effort in hours */
  estimatedHours: number;
  /** Whether task can be automated */
  automatable: boolean;
  /** Files affected */
  affectedFiles: string[];
  /** Violations this task will fix */
  violations: LinterViolation[];
  /** Dependencies (other task IDs that must be completed first) */
  dependencies: string[];
  /** Fix strategy */
  strategy: 'automated' | 'manual' | 'hybrid';
  /** Detailed steps */
  steps: string[];
}

interface FixPlan {
  /** Plan metadata */
  metadata: {
    generatedAt: Date;
    basedOnAudit: string;
    totalTasks: number;
    totalEstimatedHours: number;
    automatedTasks: number;
    manualTasks: number;
  };
  /** Execution phases */
  phases: Array<{
    name: string;
    description: string;
    tasks: string[];
    estimatedHours: number;
  }>;
  /** All fix tasks */
  tasks: FixTask[];
  /** Implementation timeline */
  timeline: Array<{
    week: number;
    tasks: string[];
    focus: string;
    deliverables: string[];
  }>;
}

/**
 * Fix Plan Generator
 */
class FixPlanGenerator {
  private projectRoot: string;
  private auditReport: AuditReport;

  constructor(auditReportPath: string) {
    this.projectRoot = process.cwd();
    
    if (!existsSync(auditReportPath)) {
      throw new Error(`Audit report not found: ${auditReportPath}`);
    }
    
    this.auditReport = JSON.parse(readFileSync(auditReportPath, 'utf8'));
  }

  /**
   * Generate comprehensive fix plan
   */
  generateFixPlan(): FixPlan {
    console.log('📋 Generating prioritized fix plan...');

    // Generate fix tasks
    const tasks = this.generateFixTasks();
    console.log(`✅ Generated ${tasks.length} fix tasks`);

    // Organize into phases
    const phases = this.organizeIntoPhases(tasks);
    console.log(`📊 Organized into ${phases.length} execution phases`);

    // Create implementation timeline
    const timeline = this.createTimeline(tasks, phases);
    console.log(`📅 Created ${timeline.length}-week implementation timeline`);

    // Calculate metadata
    const metadata = {
      generatedAt: new Date(),
      basedOnAudit: this.auditReport.metadata.timestamp.toString(),
      totalTasks: tasks.length,
      totalEstimatedHours: tasks.reduce((sum, task) => sum + task.estimatedHours, 0),
      automatedTasks: tasks.filter(task => task.automatable).length,
      manualTasks: tasks.filter(task => !task.automatable).length
    };

    return {
      metadata,
      phases,
      tasks,
      timeline
    };
  }

  /**
   * Generate fix tasks based on audit results
   */
  private generateFixTasks(): FixTask[] {
    const tasks: FixTask[] = [];
    const violations = this.auditReport.violations;

    // Group violations by rule and file for efficient processing
    const violationsByRule = this.groupViolationsByRule(violations);
    const violationsByFile = this.groupViolationsByFile(violations);

    // Task 1: Fix critical unused variable violations
    const unusedVarViolations = violations.filter(v => 
      (v.ruleId.includes('no-unused-vars') || v.ruleId.includes('unused-vars')) &&
      v.category === 'critical'
    );

    if (unusedVarViolations.length > 0) {
      tasks.push({
        id: 'fix-unused-variables',
        title: 'Fix Unused Variable Violations',
        description: `Fix ${unusedVarViolations.length} unused variable violations by prefixing with underscore or removing`,
        priority: 'critical',
        estimatedHours: Math.ceil(unusedVarViolations.length * 0.1), // 6 minutes per violation
        automatable: true,
        affectedFiles: [...new Set(unusedVarViolations.map(v => v.filePath))],
        violations: unusedVarViolations,
        dependencies: [],
        strategy: 'automated',
        steps: [
          'Run automated unused variable fix script',
          'Review changes for false positives',
          'Test affected functionality',
          'Commit changes with descriptive message'
        ]
      });
    }

    // Task 2: Replace 'any' types with proper types
    const anyTypeViolations = violations.filter(v => 
      v.ruleId.includes('no-explicit-any') || v.ruleId.includes('no-unsafe')
    );

    if (anyTypeViolations.length > 0) {
      tasks.push({
        id: 'replace-any-types',
        title: 'Replace Any Types with Proper Types',
        description: `Replace ${anyTypeViolations.length} 'any' type usages with concrete type definitions`,
        priority: 'high',
        estimatedHours: Math.ceil(anyTypeViolations.length * 0.5), // 30 minutes per violation
        automatable: false,
        affectedFiles: [...new Set(anyTypeViolations.map(v => v.filePath))],
        violations: anyTypeViolations,
        dependencies: [],
        strategy: 'manual',
        steps: [
          'Audit all any type usages',
          'Create proper type definitions',
          'Replace any types incrementally',
          'Add type validation where needed',
          'Update tests to match new types'
        ]
      });
    }

    // Task 3: Fix auto-fixable violations
    const autoFixableViolations = violations.filter(v => v.fixable);
    
    if (autoFixableViolations.length > 0) {
      tasks.push({
        id: 'auto-fix-violations',
        title: 'Auto-fix Linter Violations',
        description: `Automatically fix ${autoFixableViolations.length} auto-fixable violations`,
        priority: 'high',
        estimatedHours: 2,
        automatable: true,
        affectedFiles: [...new Set(autoFixableViolations.map(v => v.filePath))],
        violations: autoFixableViolations,
        dependencies: ['fix-unused-variables'], // Run after unused vars to avoid conflicts
        strategy: 'automated',
        steps: [
          'Run ESLint --fix on all source files',
          'Review auto-generated changes',
          'Run tests to ensure no functionality broken',
          'Commit auto-fix changes'
        ]
      });
    }

    // Task 4: Fix critical violations by file (for files with many violations)
    const criticalFileViolations = Object.entries(violationsByFile)
      .filter(([_, fileViolations]) => 
        fileViolations.filter(v => v.category === 'critical').length >= 5
      )
      .map(([filePath, fileViolations]) => ({
        filePath,
        violations: fileViolations.filter(v => v.category === 'critical')
      }));

    for (const { filePath, violations: fileViolations } of criticalFileViolations) {
      tasks.push({
        id: `fix-critical-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
        title: `Fix Critical Violations in ${filePath}`,
        description: `Fix ${fileViolations.length} critical violations in ${filePath}`,
        priority: 'high',
        estimatedHours: Math.ceil(fileViolations.length * 0.25), // 15 minutes per violation
        automatable: false,
        affectedFiles: [filePath],
        violations: fileViolations,
        dependencies: [],
        strategy: 'manual',
        steps: [
          `Review all critical violations in ${filePath}`,
          'Fix type safety issues',
          'Remove unreachable code',
          'Fix undefined variable references',
          'Test file functionality',
          'Update related tests if needed'
        ]
      });
    }

    // Task 5: Update ESLint configuration
    tasks.push({
      id: 'update-eslint-config',
      title: 'Update ESLint Configuration',
      description: 'Update ESLint rules to prevent future violations and improve code quality',
      priority: 'medium',
      estimatedHours: 4,
      automatable: false,
      affectedFiles: ['.eslintrc.js', '.eslintrc.json'],
      violations: [],
      dependencies: ['fix-unused-variables', 'auto-fix-violations'],
      strategy: 'manual',
      steps: [
        'Review current ESLint configuration',
        'Add stricter rules for type safety',
        'Configure rules for unused variables',
        'Add rules for code complexity',
        'Test configuration on codebase',
        'Update CI to enforce new rules'
      ]
    });

    // Task 6: Setup pre-commit hooks
    tasks.push({
      id: 'setup-precommit-hooks',
      title: 'Setup Pre-commit Hooks',
      description: 'Configure pre-commit hooks to catch linter violations before commit',
      priority: 'medium',
      estimatedHours: 3,
      automatable: false,
      affectedFiles: ['.husky/pre-commit', 'package.json'],
      violations: [],
      dependencies: ['update-eslint-config'],
      strategy: 'manual',
      steps: [
        'Install and configure Husky',
        'Setup pre-commit linting hook',
        'Configure lint-staged for changed files only',
        'Add type checking to pre-commit',
        'Test pre-commit hooks',
        'Document pre-commit setup for team'
      ]
    });

    // Task 7: Fix remaining important violations
    const importantViolations = violations.filter(v => 
      v.category === 'important' && 
      !tasks.some(task => task.violations.includes(v))
    );

    if (importantViolations.length > 0) {
      tasks.push({
        id: 'fix-important-violations',
        title: 'Fix Important Violations',
        description: `Fix ${importantViolations.length} important linter violations`,
        priority: 'medium',
        estimatedHours: Math.ceil(importantViolations.length * 0.2), // 12 minutes per violation
        automatable: false,
        affectedFiles: [...new Set(importantViolations.map(v => v.filePath))],
        violations: importantViolations,
        dependencies: ['auto-fix-violations'],
        strategy: 'hybrid',
        steps: [
          'Group violations by type and file',
          'Fix prefer-const violations',
          'Remove unnecessary type annotations',
          'Fix console.log statements',
          'Address empty function warnings',
          'Test changes thoroughly'
        ]
      });
    }

    // Task 8: Documentation and guidelines
    tasks.push({
      id: 'create-linting-guidelines',
      title: 'Create Linting Guidelines',
      description: 'Create documentation and guidelines for maintaining code quality',
      priority: 'low',
      estimatedHours: 6,
      automatable: false,
      affectedFiles: ['docs/linting-guidelines.md', 'docs/code-quality.md'],
      violations: [],
      dependencies: ['setup-precommit-hooks'],
      strategy: 'manual',
      steps: [
        'Document ESLint rules and their purpose',
        'Create troubleshooting guide for common violations',
        'Write guidelines for type safety',
        'Document pre-commit hook usage',
        'Create onboarding checklist for new developers',
        'Add examples of good and bad code patterns'
      ]
    });

    return tasks;
  }

  /**
   * Organize tasks into execution phases
   */
  private organizeIntoPhases(tasks: FixTask[]): FixPlan['phases'] {
    const phases: FixPlan['phases'] = [
      {
        name: 'Critical Fixes',
        description: 'Fix critical violations that can cause runtime errors',
        tasks: tasks
          .filter(task => task.priority === 'critical')
          .map(task => task.id),
        estimatedHours: 0
      },
      {
        name: 'High Priority Fixes',
        description: 'Fix high priority violations and setup automation',
        tasks: tasks
          .filter(task => task.priority === 'high')
          .map(task => task.id),
        estimatedHours: 0
      },
      {
        name: 'Configuration and Automation',
        description: 'Update configuration and setup automated quality checks',
        tasks: tasks
          .filter(task => task.priority === 'medium' && task.strategy !== 'manual')
          .map(task => task.id),
        estimatedHours: 0
      },
      {
        name: 'Remaining Fixes',
        description: 'Fix remaining violations and create documentation',
        tasks: tasks
          .filter(task => task.priority === 'medium' && task.strategy === 'manual' || task.priority === 'low')
          .map(task => task.id),
        estimatedHours: 0
      }
    ];

    // Calculate estimated hours for each phase
    for (const phase of phases) {
      phase.estimatedHours = phase.tasks.reduce((sum, taskId) => {
        const task = tasks.find(t => t.id === taskId);
        return sum + (task?.estimatedHours || 0);
      }, 0);
    }

    return phases;
  }

  /**
   * Create implementation timeline
   */
  private createTimeline(tasks: FixTask[], phases: FixPlan['phases']): FixPlan['timeline'] {
    const timeline: FixPlan['timeline'] = [];
    let currentWeek = 1;

    for (const phase of phases) {
      const phaseTasks = tasks.filter(task => phase.tasks.includes(task.id));
      const phaseHours = phase.estimatedHours;
      
      // Assume 20 hours of work per week
      const weeksNeeded = Math.ceil(phaseHours / 20);
      
      for (let week = 0; week < weeksNeeded; week++) {
        const weekTasks = phaseTasks.slice(week * 2, (week + 1) * 2); // 2 tasks per week max
        
        timeline.push({
          week: currentWeek + week,
          tasks: weekTasks.map(task => task.id),
          focus: phase.name,
          deliverables: this.getWeekDeliverables(weekTasks, phase.name)
        });
      }
      
      currentWeek += weeksNeeded;
    }

    return timeline;
  }

  /**
   * Get deliverables for a week
   */
  private getWeekDeliverables(tasks: FixTask[], phaseName: string): string[] {
    const deliverables: string[] = [];

    if (phaseName === 'Critical Fixes') {
      deliverables.push('All critical violations resolved');
      deliverables.push('Code passes basic type checking');
    } else if (phaseName === 'High Priority Fixes') {
      deliverables.push('Auto-fixable violations resolved');
      deliverables.push('Type safety significantly improved');
    } else if (phaseName === 'Configuration and Automation') {
      deliverables.push('ESLint configuration updated');
      deliverables.push('Pre-commit hooks configured');
      deliverables.push('CI pipeline enforces quality checks');
    } else if (phaseName === 'Remaining Fixes') {
      deliverables.push('All linter violations resolved');
      deliverables.push('Code quality documentation complete');
      deliverables.push('Team onboarded on new quality standards');
    }

    return deliverables;
  }

  /**
   * Group violations by rule
   */
  private groupViolationsByRule(violations: LinterViolation[]): Record<string, LinterViolation[]> {
    return violations.reduce((groups, violation) => {
      const rule = violation.ruleId;
      if (!groups[rule]) {
        groups[rule] = [];
      }
      groups[rule].push(violation);
      return groups;
    }, {} as Record<string, LinterViolation[]>);
  }

  /**
   * Group violations by file
   */
  private groupViolationsByFile(violations: LinterViolation[]): Record<string, LinterViolation[]> {
    return violations.reduce((groups, violation) => {
      const file = violation.filePath;
      if (!groups[file]) {
        groups[file] = [];
      }
      groups[file].push(violation);
      return groups;
    }, {} as Record<string, LinterViolation[]>);
  }

  /**
   * Save fix plan to file
   */
  savePlan(plan: FixPlan, outputPath: string): void {
    // Save JSON plan
    const jsonPath = outputPath.replace(/\.[^.]+$/, '.json');
    writeFileSync(jsonPath, JSON.stringify(plan, null, 2));
    console.log(`📄 Fix plan saved: ${jsonPath}`);

    // Save Markdown plan
    const markdownPath = outputPath.replace(/\.[^.]+$/, '.md');
    const markdownContent = this.generateMarkdownPlan(plan);
    writeFileSync(markdownPath, markdownContent);
    console.log(`📄 Markdown plan saved: ${markdownPath}`);
  }

  /**
   * Generate Markdown plan
   */
  private generateMarkdownPlan(plan: FixPlan): string {
    return `# Linter Fix Plan

Generated on ${plan.metadata.generatedAt.toLocaleString()}

## Summary

- **Total Tasks:** ${plan.metadata.totalTasks}
- **Estimated Hours:** ${plan.metadata.totalEstimatedHours}
- **Automated Tasks:** ${plan.metadata.automatedTasks}
- **Manual Tasks:** ${plan.metadata.manualTasks}

## Execution Phases

${plan.phases.map((phase, index) => `
### Phase ${index + 1}: ${phase.name}

${phase.description}

**Estimated Hours:** ${phase.estimatedHours}

**Tasks:**
${phase.tasks.map(taskId => {
  const task = plan.tasks.find(t => t.id === taskId);
  return `- ${task?.title} (${task?.estimatedHours}h, ${task?.strategy})`;
}).join('\n')}
`).join('')}

## Detailed Tasks

${plan.tasks.map(task => `
### ${task.title}

**Priority:** ${task.priority}  
**Estimated Hours:** ${task.estimatedHours}  
**Strategy:** ${task.strategy}  
**Automatable:** ${task.automatable ? 'Yes' : 'No'}  
**Affected Files:** ${task.affectedFiles.length}  
**Violations Fixed:** ${task.violations.length}

${task.description}

**Steps:**
${task.steps.map(step => `1. ${step}`).join('\n')}

${task.dependencies.length > 0 ? `**Dependencies:** ${task.dependencies.join(', ')}` : ''}
`).join('')}

## Implementation Timeline

${plan.timeline.map(week => `
### Week ${week.week}: ${week.focus}

**Tasks:**
${week.tasks.map(taskId => {
  const task = plan.tasks.find(t => t.id === taskId);
  return `- ${task?.title}`;
}).join('\n')}

**Deliverables:**
${week.deliverables.map(deliverable => `- ${deliverable}`).join('\n')}
`).join('')}

## Getting Started

1. **Review this plan** with the development team
2. **Start with Phase 1** (Critical Fixes) tasks
3. **Run automated tasks first** to get quick wins
4. **Follow the timeline** but adjust based on team capacity
5. **Track progress** and update estimates as needed

## Notes

- This plan is based on the linter audit results
- Estimates are rough and should be adjusted based on actual complexity
- Some tasks may be combined or split based on implementation details
- Regular progress reviews are recommended to stay on track
`;
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: tsx generate-fix-plan.ts <audit-report-path> [output-path]');
    process.exit(1);
  }

  const auditReportPath = args[0];
  const outputPath = args[1] || join(process.cwd(), 'reports', 'linter-audit', 'fix-plan.json');

  try {
    const generator = new FixPlanGenerator(auditReportPath);
    const plan = generator.generateFixPlan();
    
    generator.savePlan(plan, outputPath);
    
    console.log('\n📋 Fix Plan Summary:');
    console.log(`   Total tasks: ${plan.metadata.totalTasks}`);
    console.log(`   Estimated hours: ${plan.metadata.totalEstimatedHours}`);
    console.log(`   Automated tasks: ${plan.metadata.automatedTasks}`);
    console.log(`   Manual tasks: ${plan.metadata.manualTasks}`);
    console.log(`   Implementation timeline: ${plan.timeline.length} weeks`);
    
    console.log('\n🎯 Next Steps:');
    console.log('   1. Review the generated fix plan');
    console.log('   2. Start with critical fixes');
    console.log('   3. Run automated fixes first');
    console.log('   4. Follow the implementation timeline');

    process.exit(0);
  } catch (error) {
    console.error('❌ Fix plan generation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { FixPlanGenerator, type FixPlan, type FixTask };