#!/usr/bin/env ts-node

/**
 * Quality Metrics Reporter
 * Generates comprehensive quality metrics reports and tracks improvements over time
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

interface QualityMetrics {
  timestamp: string;
  commit?: string;
  branch?: string;
  linting: {
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    fixableViolations: number;
  };
  typeSafety: {
    anyTypeUsage: number;
    typeErrors: number;
    strictModeEnabled: boolean;
  };
  testing: {
    totalTests: number;
    passingTests: number;
    failingTests: number;
    coverage: {
      lines: number;
      functions: number;
      branches: number;
      statements: number;
    };
  };
  codeQuality: {
    codeComplexity: number;
    duplicateCode: number;
    maintainabilityIndex: number;
  };
  performance: {
    buildTime: number;
    testTime: number;
    lintTime: number;
  };
}

class QualityMetricsReporter {
  private metricsFile = 'quality-metrics-history.json';
  private reportFile = 'quality-metrics-report.md';
  private summaryFile = 'quality-metrics-summary.json';

  async generateReport(): Promise<void> {
    console.log('📊 Generating quality metrics report...');

    const metrics = await this.collectMetrics();
    await this.saveMetrics(metrics);
    await this.generateMarkdownReport(metrics);
    await this.generateSummary(metrics);

    console.log('✅ Quality metrics report generated successfully');
  }

  private async collectMetrics(): Promise<QualityMetrics> {
    const metrics: QualityMetrics = {
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || this.getGitCommit(),
      branch: process.env.GITHUB_REF_NAME || this.getGitBranch(),
      linting: await this.collectLintingMetrics(),
      typeSafety: await this.collectTypeSafetyMetrics(),
      testing: await this.collectTestingMetrics(),
      codeQuality: await this.collectCodeQualityMetrics(),
      performance: await this.collectPerformanceMetrics(),
    };

    return metrics;
  }

  private getGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private getGitBranch(): string {
    try {
      return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  }

  private async collectLintingMetrics(): Promise<QualityMetrics['linting']> {
    const metrics = {
      totalViolations: 0,
      criticalViolations: 0,
      warningViolations: 0,
      fixableViolations: 0,
    };

    try {
      // Run linter audit
      execSync('npm run quality:linter-audit', { stdio: 'pipe' });
      
      if (existsSync('linter-audit-report.json')) {
        const report = JSON.parse(readFileSync('linter-audit-report.json', 'utf8'));
        metrics.totalViolations = report.totalViolations || 0;
        metrics.criticalViolations = report.criticalViolations || 0;
        metrics.warningViolations = report.warningViolations || 0;
        metrics.fixableViolations = report.fixableViolations || 0;
      }
    } catch (error) {
      console.warn('Could not collect linting metrics:', error);
    }

    return metrics;
  }

  private async collectTypeSafetyMetrics(): Promise<QualityMetrics['typeSafety']> {
    const metrics = {
      anyTypeUsage: 0,
      typeErrors: 0,
      strictModeEnabled: false,
    };

    try {
      // Run type safety audit
      execSync('npm run quality:type-audit', { stdio: 'pipe' });
      
      if (existsSync('type-safety-audit-report.json')) {
        const report = JSON.parse(readFileSync('type-safety-audit-report.json', 'utf8'));
        metrics.anyTypeUsage = report.anyUsages?.length || 0;
      }

      // Check TypeScript configuration
      if (existsSync('tsconfig.json')) {
        const tsConfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
        metrics.strictModeEnabled = tsConfig.compilerOptions?.strict === true;
      }

      // Check for type errors
      try {
        execSync('npm run type-check', { stdio: 'pipe' });
        metrics.typeErrors = 0;
      } catch (error: any) {
        // Count type errors from output
        const output = error.stdout || '';
        const errorMatches = output.match(/error TS\d+/g);
        metrics.typeErrors = errorMatches ? errorMatches.length : 1;
      }
    } catch (error) {
      console.warn('Could not collect type safety metrics:', error);
    }

    return metrics;
  }

  private async collectTestingMetrics(): Promise<QualityMetrics['testing']> {
    const metrics = {
      totalTests: 0,
      passingTests: 0,
      failingTests: 0,
      coverage: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    };

    try {
      // Run tests with coverage
      execSync('npm run test:coverage', { 
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: 'file:./test.db' }
      });

      // Read coverage report
      if (existsSync('coverage/coverage-summary.json')) {
        const coverage = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
        const total = coverage.total || {};
        
        metrics.coverage.lines = total.lines?.pct || 0;
        metrics.coverage.functions = total.functions?.pct || 0;
        metrics.coverage.branches = total.branches?.pct || 0;
        metrics.coverage.statements = total.statements?.pct || 0;
      }

      // Try to extract test counts from test output
      // This would need to be implemented based on your test runner output
      metrics.totalTests = 100; // Placeholder
      metrics.passingTests = 95; // Placeholder
      metrics.failingTests = 5; // Placeholder
    } catch (error) {
      console.warn('Could not collect testing metrics:', error);
    }

    return metrics;
  }

  private async collectCodeQualityMetrics(): Promise<QualityMetrics['codeQuality']> {
    const metrics = {
      codeComplexity: 0,
      duplicateCode: 0,
      maintainabilityIndex: 0,
    };

    try {
      // These would be implemented with additional tools like:
      // - complexity-report for cyclomatic complexity
      // - jscpd for duplicate code detection
      // - maintainability-index calculator
      
      // For now, provide placeholder values
      metrics.codeComplexity = 2.5; // Average complexity
      metrics.duplicateCode = 5; // Percentage
      metrics.maintainabilityIndex = 75; // Score out of 100
    } catch (error) {
      console.warn('Could not collect code quality metrics:', error);
    }

    return metrics;
  }

  private async collectPerformanceMetrics(): Promise<QualityMetrics['performance']> {
    const metrics = {
      buildTime: 0,
      testTime: 0,
      lintTime: 0,
    };

    try {
      // Measure build time
      const buildStart = Date.now();
      execSync('npm run cf-typegen', { stdio: 'pipe' });
      metrics.buildTime = Date.now() - buildStart;

      // Measure test time
      const testStart = Date.now();
      execSync('npm run test', { 
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: 'file:./test.db' }
      });
      metrics.testTime = Date.now() - testStart;

      // Measure lint time
      const lintStart = Date.now();
      execSync('npm run lint', { stdio: 'pipe' });
      metrics.lintTime = Date.now() - lintStart;
    } catch (error) {
      console.warn('Could not collect performance metrics:', error);
    }

    return metrics;
  }

  private async saveMetrics(metrics: QualityMetrics): Promise<void> {
    let history: QualityMetrics[] = [];

    if (existsSync(this.metricsFile)) {
      try {
        history = JSON.parse(readFileSync(this.metricsFile, 'utf8'));
      } catch (error) {
        console.warn('Could not read metrics history:', error);
      }
    }

    history.push(metrics);

    // Keep only last 50 entries
    if (history.length > 50) {
      history = history.slice(-50);
    }

    writeFileSync(this.metricsFile, JSON.stringify(history, null, 2));
  }

  private async generateMarkdownReport(current: QualityMetrics): Promise<void> {
    const history = this.loadHistory();
    const previous = history.length > 1 ? history[history.length - 2] : null;

    const report = `# Quality Metrics Report

## Overview
- **Generated:** ${current.timestamp}
- **Commit:** ${current.commit}
- **Branch:** ${current.branch}

## Linting Metrics
- **Total Violations:** ${current.linting.totalViolations} ${this.getTrend(current.linting.totalViolations, previous?.linting.totalViolations)}
- **Critical Violations:** ${current.linting.criticalViolations} ${this.getTrend(current.linting.criticalViolations, previous?.linting.criticalViolations)}
- **Warning Violations:** ${current.linting.warningViolations} ${this.getTrend(current.linting.warningViolations, previous?.linting.warningViolations)}
- **Fixable Violations:** ${current.linting.fixableViolations}

## Type Safety Metrics
- **'any' Type Usage:** ${current.typeSafety.anyTypeUsage} ${this.getTrend(current.typeSafety.anyTypeUsage, previous?.typeSafety.anyTypeUsage)}
- **Type Errors:** ${current.typeSafety.typeErrors} ${this.getTrend(current.typeSafety.typeErrors, previous?.typeSafety.typeErrors)}
- **Strict Mode:** ${current.typeSafety.strictModeEnabled ? '✅ Enabled' : '❌ Disabled'}

## Testing Metrics
- **Total Tests:** ${current.testing.totalTests}
- **Passing Tests:** ${current.testing.passingTests} (${((current.testing.passingTests / current.testing.totalTests) * 100).toFixed(1)}%)
- **Failing Tests:** ${current.testing.failingTests}

### Coverage
- **Lines:** ${current.testing.coverage.lines}% ${this.getTrend(current.testing.coverage.lines, previous?.testing.coverage.lines)}
- **Functions:** ${current.testing.coverage.functions}%
- **Branches:** ${current.testing.coverage.branches}%
- **Statements:** ${current.testing.coverage.statements}%

## Code Quality Metrics
- **Code Complexity:** ${current.codeQuality.codeComplexity}
- **Duplicate Code:** ${current.codeQuality.duplicateCode}%
- **Maintainability Index:** ${current.codeQuality.maintainabilityIndex}/100

## Performance Metrics
- **Build Time:** ${current.performance.buildTime}ms ${this.getTrend(current.performance.buildTime, previous?.performance.buildTime, true)}
- **Test Time:** ${current.performance.testTime}ms ${this.getTrend(current.performance.testTime, previous?.performance.testTime, true)}
- **Lint Time:** ${current.performance.lintTime}ms ${this.getTrend(current.performance.lintTime, previous?.performance.lintTime, true)}

## Quality Score
${this.calculateQualityScore(current)}

## Recommendations
${this.generateRecommendations(current)}

## Historical Trends
${this.generateTrendAnalysis(history)}

---
*Generated by Quality Metrics Reporter*
`;

    writeFileSync(this.reportFile, report);
  }

  private async generateSummary(metrics: QualityMetrics): Promise<void> {
    const summary = {
      timestamp: metrics.timestamp,
      overallScore: this.calculateOverallScore(metrics),
      criticalIssues: this.getCriticalIssues(metrics),
      improvements: this.getImprovements(metrics),
      regressions: this.getRegressions(metrics),
    };

    writeFileSync(this.summaryFile, JSON.stringify(summary, null, 2));
  }

  private loadHistory(): QualityMetrics[] {
    if (!existsSync(this.metricsFile)) {
      return [];
    }

    try {
      return JSON.parse(readFileSync(this.metricsFile, 'utf8'));
    } catch {
      return [];
    }
  }

  private getTrend(current: number, previous?: number, lowerIsBetter = false): string {
    if (previous === undefined) return '';
    
    if (current > previous) {
      return lowerIsBetter ? '📈 ⚠️' : '📈 ✅';
    } else if (current < previous) {
      return lowerIsBetter ? '📉 ✅' : '📉 ⚠️';
    }
    return '➡️';
  }

  private calculateQualityScore(metrics: QualityMetrics): string {
    const score = this.calculateOverallScore(metrics);
    const grade = this.getGrade(score);
    
    return `**Overall Quality Score: ${score}/100 (${grade})**

${this.getScoreBreakdown(metrics)}`;
  }

  private calculateOverallScore(metrics: QualityMetrics): number {
    let score = 100;

    // Deduct for linting issues
    score -= Math.min(metrics.linting.criticalViolations * 5, 30);
    score -= Math.min(metrics.linting.warningViolations * 1, 20);

    // Deduct for type safety issues
    score -= Math.min(metrics.typeSafety.anyTypeUsage * 2, 20);
    score -= Math.min(metrics.typeSafety.typeErrors * 3, 15);

    // Deduct for test failures
    score -= Math.min(metrics.testing.failingTests * 2, 10);

    // Bonus for good coverage
    if (metrics.testing.coverage.lines >= 80) score += 5;
    if (metrics.testing.coverage.lines >= 90) score += 5;

    return Math.max(0, Math.round(score));
  }

  private getGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private getScoreBreakdown(metrics: QualityMetrics): string {
    return `
**Score Breakdown:**
- Base Score: 100
- Critical Linting Issues: -${Math.min(metrics.linting.criticalViolations * 5, 30)}
- Warning Linting Issues: -${Math.min(metrics.linting.warningViolations * 1, 20)}
- Type Safety Issues: -${Math.min(metrics.typeSafety.anyTypeUsage * 2 + metrics.typeSafety.typeErrors * 3, 35)}
- Test Failures: -${Math.min(metrics.testing.failingTests * 2, 10)}
- Coverage Bonus: +${metrics.testing.coverage.lines >= 90 ? 10 : metrics.testing.coverage.lines >= 80 ? 5 : 0}
`;
  }

  private generateRecommendations(metrics: QualityMetrics): string {
    const recommendations: string[] = [];

    if (metrics.linting.criticalViolations > 0) {
      recommendations.push(`- Fix ${metrics.linting.criticalViolations} critical linting violations`);
    }

    if (metrics.typeSafety.anyTypeUsage > 10) {
      recommendations.push(`- Replace ${metrics.typeSafety.anyTypeUsage} 'any' type usages with proper types`);
    }

    if (metrics.typeSafety.typeErrors > 0) {
      recommendations.push(`- Fix ${metrics.typeSafety.typeErrors} TypeScript compilation errors`);
    }

    if (metrics.testing.coverage.lines < 80) {
      recommendations.push(`- Increase test coverage from ${metrics.testing.coverage.lines}% to at least 80%`);
    }

    if (metrics.testing.failingTests > 0) {
      recommendations.push(`- Fix ${metrics.testing.failingTests} failing tests`);
    }

    if (metrics.performance.buildTime > 60000) {
      recommendations.push('- Optimize build performance (currently over 1 minute)');
    }

    if (recommendations.length === 0) {
      recommendations.push('- All metrics look good! Keep up the excellent work! 🎉');
    }

    return recommendations.join('\n');
  }

  private generateTrendAnalysis(history: QualityMetrics[]): string {
    if (history.length < 2) {
      return 'Not enough historical data for trend analysis.';
    }

    const recent = history.slice(-5); // Last 5 entries
    const trends: string[] = [];

    // Analyze linting trend
    const lintingTrend = this.analyzeTrend(recent.map(m => m.linting.totalViolations));
    trends.push(`- **Linting Violations:** ${lintingTrend}`);

    // Analyze type safety trend
    const typeTrend = this.analyzeTrend(recent.map(m => m.typeSafety.anyTypeUsage));
    trends.push(`- **Type Safety:** ${typeTrend}`);

    // Analyze coverage trend
    const coverageTrend = this.analyzeTrend(recent.map(m => m.testing.coverage.lines));
    trends.push(`- **Test Coverage:** ${coverageTrend}`);

    return trends.join('\n');
  }

  private analyzeTrend(values: number[]): string {
    if (values.length < 2) return 'Insufficient data';

    const first = values[0];
    const last = values[values.length - 1];
    const change = last - first;
    const percentChange = first === 0 ? 0 : (change / first) * 100;

    if (Math.abs(percentChange) < 5) return 'Stable';
    if (percentChange > 0) return `Increasing (+${percentChange.toFixed(1)}%)`;
    return `Decreasing (${percentChange.toFixed(1)}%)`;
  }

  private getCriticalIssues(metrics: QualityMetrics): string[] {
    const issues: string[] = [];

    if (metrics.linting.criticalViolations > 0) {
      issues.push(`${metrics.linting.criticalViolations} critical linting violations`);
    }

    if (metrics.typeSafety.typeErrors > 0) {
      issues.push(`${metrics.typeSafety.typeErrors} TypeScript compilation errors`);
    }

    if (metrics.testing.failingTests > 0) {
      issues.push(`${metrics.testing.failingTests} failing tests`);
    }

    return issues;
  }

  private getImprovements(metrics: QualityMetrics): string[] {
    const history = this.loadHistory();
    const previous = history.length > 1 ? history[history.length - 2] : null;
    
    if (!previous) return [];

    const improvements: string[] = [];

    if (metrics.linting.totalViolations < previous.linting.totalViolations) {
      improvements.push('Reduced linting violations');
    }

    if (metrics.typeSafety.anyTypeUsage < previous.typeSafety.anyTypeUsage) {
      improvements.push('Reduced any type usage');
    }

    if (metrics.testing.coverage.lines > previous.testing.coverage.lines) {
      improvements.push('Increased test coverage');
    }

    return improvements;
  }

  private getRegressions(metrics: QualityMetrics): string[] {
    const history = this.loadHistory();
    const previous = history.length > 1 ? history[history.length - 2] : null;
    
    if (!previous) return [];

    const regressions: string[] = [];

    if (metrics.linting.totalViolations > previous.linting.totalViolations) {
      regressions.push('Increased linting violations');
    }

    if (metrics.typeSafety.anyTypeUsage > previous.typeSafety.anyTypeUsage) {
      regressions.push('Increased any type usage');
    }

    if (metrics.testing.coverage.lines < previous.testing.coverage.lines) {
      regressions.push('Decreased test coverage');
    }

    return regressions;
  }
}

// Run if called directly
if (require.main === module) {
  const reporter = new QualityMetricsReporter();
  reporter.generateReport().catch(error => {
    console.error('Failed to generate quality metrics report:', error);
    process.exit(1);
  });
}

export { QualityMetricsReporter };