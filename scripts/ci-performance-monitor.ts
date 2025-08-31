#!/usr/bin/env ts-node

/**
 * CI Performance Monitor
 * Tracks and reports CI pipeline performance metrics
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface PerformanceMetrics {
  timestamp: string;
  commit: string;
  branch: string;
  totalDuration: number;
  stages: {
    setup: number;
    qualityChecks: number;
    tests: number;
    build: number;
    deployment?: number;
  };
  testResults: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  qualityMetrics: {
    linterViolations: number;
    typeErrors: number;
    testCoverage: number;
    securityIssues: number;
  };
}

class CIPerformanceMonitor {
  private metricsFile = 'ci-performance-metrics.json';
  private reportFile = 'ci-performance-report.md';

  async recordMetrics(): Promise<void> {
    const metrics: PerformanceMetrics = {
      timestamp: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || 'unknown',
      branch: process.env.GITHUB_REF_NAME || 'unknown',
      totalDuration: this.calculateTotalDuration(),
      stages: {
        setup: this.getStageTime('setup', 30),
        qualityChecks: this.getStageTime('quality-checks', 120),
        tests: this.getStageTime('tests', 180),
        build: this.getStageTime('build', 60),
      },
      testResults: await this.getTestResults(),
      qualityMetrics: await this.getQualityMetrics(),
    };

    await this.saveMetrics(metrics);
    await this.generateReport(metrics);
  }

  private calculateTotalDuration(): number {
    const startTime = process.env.CI_START_TIME;
    if (!startTime) return 0;
    
    const start = parseInt(startTime, 10);
    const end = Math.floor(Date.now() / 1000);
    return end - start;
  }

  private getStageTime(stage: string, defaultTime: number): number {
    const envVar = `${stage.toUpperCase().replace('-', '_')}_DURATION`;
    const duration = process.env[envVar];
    return duration ? parseInt(duration, 10) : defaultTime;
  }

  private async getTestResults(): Promise<PerformanceMetrics['testResults']> {
    // Try to read test results from vitest output
    const defaultResults = { total: 0, passed: 0, failed: 0, skipped: 0 };
    
    try {
      // This would be populated by the test runner
      const testOutput = process.env.TEST_RESULTS;
      if (testOutput) {
        return JSON.parse(testOutput);
      }
    } catch (error) {
      console.warn('Could not parse test results:', error);
    }
    
    return defaultResults;
  }

  private async getQualityMetrics(): Promise<PerformanceMetrics['qualityMetrics']> {
    const metrics = {
      linterViolations: 0,
      typeErrors: 0,
      testCoverage: 0,
      securityIssues: 0,
    };

    try {
      // Read linter audit report
      if (existsSync('linter-audit-report.json')) {
        const linterReport = JSON.parse(readFileSync('linter-audit-report.json', 'utf8'));
        metrics.linterViolations = linterReport.totalViolations || 0;
      }

      // Read type safety audit report
      if (existsSync('type-safety-audit-report.json')) {
        const typeReport = JSON.parse(readFileSync('type-safety-audit-report.json', 'utf8'));
        metrics.typeErrors = typeReport.anyUsages?.length || 0;
      }

      // Read coverage report
      if (existsSync('coverage/coverage-summary.json')) {
        const coverageReport = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
        metrics.testCoverage = coverageReport.total?.lines?.pct || 0;
      }

      // Security issues would come from npm audit
      const securityEnv = process.env.SECURITY_ISSUES;
      if (securityEnv) {
        metrics.securityIssues = parseInt(securityEnv, 10);
      }
    } catch (error) {
      console.warn('Could not read quality metrics:', error);
    }

    return metrics;
  }

  private async saveMetrics(metrics: PerformanceMetrics): Promise<void> {
    let allMetrics: PerformanceMetrics[] = [];
    
    if (existsSync(this.metricsFile)) {
      try {
        const existing = readFileSync(this.metricsFile, 'utf8');
        allMetrics = JSON.parse(existing);
      } catch (error) {
        console.warn('Could not read existing metrics:', error);
      }
    }

    allMetrics.push(metrics);
    
    // Keep only last 100 entries
    if (allMetrics.length > 100) {
      allMetrics = allMetrics.slice(-100);
    }

    writeFileSync(this.metricsFile, JSON.stringify(allMetrics, null, 2));
  }

  private async generateReport(currentMetrics: PerformanceMetrics): Promise<void> {
    let historicalMetrics: PerformanceMetrics[] = [];
    
    if (existsSync(this.metricsFile)) {
      try {
        historicalMetrics = JSON.parse(readFileSync(this.metricsFile, 'utf8'));
      } catch (error) {
        console.warn('Could not read historical metrics:', error);
      }
    }

    const report = this.createPerformanceReport(currentMetrics, historicalMetrics);
    writeFileSync(this.reportFile, report);
    
    console.log('📊 CI Performance Report generated');
    console.log(`Total Duration: ${currentMetrics.totalDuration}s`);
    console.log(`Test Coverage: ${currentMetrics.qualityMetrics.testCoverage}%`);
    console.log(`Linter Violations: ${currentMetrics.qualityMetrics.linterViolations}`);
  }

  private createPerformanceReport(current: PerformanceMetrics, historical: PerformanceMetrics[]): string {
    const avgDuration = historical.length > 0 
      ? historical.reduce((sum, m) => sum + m.totalDuration, 0) / historical.length 
      : current.totalDuration;

    const trend = current.totalDuration > avgDuration ? '📈' : '📉';
    const coverageTrend = this.getCoverageTrend(current, historical);

    return `# CI Performance Report

## Current Build
- **Commit:** ${current.commit}
- **Branch:** ${current.branch}
- **Timestamp:** ${current.timestamp}
- **Total Duration:** ${current.totalDuration}s ${trend}

## Stage Breakdown
- **Setup:** ${current.stages.setup}s
- **Quality Checks:** ${current.stages.qualityChecks}s
- **Tests:** ${current.stages.tests}s
- **Build:** ${current.stages.build}s

## Test Results
- **Total Tests:** ${current.testResults.total}
- **Passed:** ${current.testResults.passed} ✅
- **Failed:** ${current.testResults.failed} ❌
- **Skipped:** ${current.testResults.skipped} ⏭️

## Quality Metrics
- **Test Coverage:** ${current.qualityMetrics.testCoverage}% ${coverageTrend}
- **Linter Violations:** ${current.qualityMetrics.linterViolations}
- **Type Errors:** ${current.qualityMetrics.typeErrors}
- **Security Issues:** ${current.qualityMetrics.securityIssues}

## Performance Trends
- **Average Duration:** ${Math.round(avgDuration)}s
- **Performance vs Average:** ${current.totalDuration > avgDuration ? 'Slower' : 'Faster'}
- **Historical Builds:** ${historical.length}

## Recommendations
${this.generateRecommendations(current, avgDuration)}

---
*Generated by CI Performance Monitor at ${new Date().toISOString()}*
`;
  }

  private getCoverageTrend(current: PerformanceMetrics, historical: PerformanceMetrics[]): string {
    if (historical.length === 0) return '';
    
    const lastCoverage = historical[historical.length - 1]?.qualityMetrics.testCoverage || 0;
    const currentCoverage = current.qualityMetrics.testCoverage;
    
    if (currentCoverage > lastCoverage) return '📈';
    if (currentCoverage < lastCoverage) return '📉';
    return '➡️';
  }

  private generateRecommendations(current: PerformanceMetrics, avgDuration: number): string {
    const recommendations: string[] = [];

    if (current.totalDuration > avgDuration * 1.2) {
      recommendations.push('- Consider optimizing CI pipeline - build is 20% slower than average');
    }

    if (current.qualityMetrics.testCoverage < 80) {
      recommendations.push('- Increase test coverage - currently below 80%');
    }

    if (current.qualityMetrics.linterViolations > 0) {
      recommendations.push('- Fix linter violations to improve code quality');
    }

    if (current.qualityMetrics.typeErrors > 0) {
      recommendations.push('- Address TypeScript type errors for better type safety');
    }

    if (current.testResults.failed > 0) {
      recommendations.push('- Fix failing tests before deployment');
    }

    if (recommendations.length === 0) {
      recommendations.push('- All metrics look good! 🎉');
    }

    return recommendations.join('\n');
  }
}

// Run if called directly
if (require.main === module) {
  const monitor = new CIPerformanceMonitor();
  monitor.recordMetrics().catch(error => {
    console.error('Failed to record CI performance metrics:', error);
    process.exit(1);
  });
}

export { CIPerformanceMonitor };