/**
 * CI Error Reporter
 * Specialized error handling and reporting for CI environments
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface CIError {
  /** Error ID */
  id: string;
  /** Error timestamp */
  timestamp: Date;
  /** Error type */
  type: 'database' | 'test' | 'migration' | 'isolation' | 'system';
  /** Error severity */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Error message */
  message: string;
  /** Error stack trace */
  stack?: string;
  /** Test context */
  testContext?: {
    testName: string;
    testFile: string;
    testSuite: string;
  };
  /** Database context */
  databaseContext?: {
    connectionId: string;
    query?: string;
    params?: any[];
  };
  /** System context */
  systemContext?: {
    nodeVersion: string;
    platform: string;
    memory: string;
    cpu: string;
  };
  /** CI context */
  ciContext?: {
    buildId: string;
    jobId: string;
    branch: string;
    commit: string;
    pr?: string;
  };
  /** Recovery attempts */
  recoveryAttempts: Array<{
    strategy: string;
    timestamp: Date;
    success: boolean;
    error?: string;
  }>;
  /** Whether error was resolved */
  resolved: boolean;
  /** Resolution details */
  resolution?: {
    strategy: string;
    timestamp: Date;
    details: string;
  };
}

export interface CIErrorReport {
  /** Report metadata */
  metadata: {
    reportId: string;
    timestamp: Date;
    environment: string;
    buildInfo: any;
    systemInfo: any;
  };
  /** Error summary */
  summary: {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    resolvedErrors: number;
    unresolvedErrors: number;
  };
  /** Detailed errors */
  errors: CIError[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * CI Error Reporter
 * Collects, analyzes, and reports errors in CI environment
 */
export class CIErrorReporter {
  private errors: Map<string, CIError> = new Map();
  private reportDir: string;
  private enableConsoleOutput: boolean;
  private enableFileOutput: boolean;
  private maxErrors: number;

  constructor(options: {
    reportDir?: string;
    enableConsoleOutput?: boolean;
    enableFileOutput?: boolean;
    maxErrors?: number;
  } = {}) {
    this.reportDir = options.reportDir || join(process.cwd(), 'ci-reports');
    this.enableConsoleOutput = options.enableConsoleOutput ?? true;
    this.enableFileOutput = options.enableFileOutput ?? true;
    this.maxErrors = options.maxErrors || 1000;

    // Ensure report directory exists
    if (this.enableFileOutput && !existsSync(this.reportDir)) {
      mkdirSync(this.reportDir, { recursive: true });
    }
  }

  /**
   * Report an error
   */
  reportError(
    type: CIError['type'],
    severity: CIError['severity'],
    message: string,
    context?: {
      error?: Error;
      testContext?: CIError['testContext'];
      databaseContext?: CIError['databaseContext'];
    }
  ): string {
    const errorId = this.generateErrorId();
    const timestamp = new Date();

    const ciError: CIError = {
      id: errorId,
      timestamp,
      type,
      severity,
      message,
      stack: context?.error?.stack,
      testContext: context?.testContext,
      databaseContext: context?.databaseContext,
      systemContext: this.getSystemContext(),
      ciContext: this.getCIContext(),
      recoveryAttempts: [],
      resolved: false
    };

    this.errors.set(errorId, ciError);

    // Trim errors if we exceed max
    if (this.errors.size > this.maxErrors) {
      const oldestErrorId = Array.from(this.errors.keys())[0];
      this.errors.delete(oldestErrorId);
    }

    // Output error
    this.outputError(ciError);

    return errorId;
  }

  /**
   * Report recovery attempt
   */
  reportRecoveryAttempt(
    errorId: string,
    strategy: string,
    success: boolean,
    error?: string
  ): void {
    const ciError = this.errors.get(errorId);
    if (!ciError) {
      return;
    }

    ciError.recoveryAttempts.push({
      strategy,
      timestamp: new Date(),
      success,
      error
    });

    if (success) {
      ciError.resolved = true;
      ciError.resolution = {
        strategy,
        timestamp: new Date(),
        details: `Successfully recovered using strategy: ${strategy}`
      };
    }

    this.errors.set(errorId, ciError);
  }

  /**
   * Mark error as resolved
   */
  markErrorResolved(
    errorId: string,
    strategy: string,
    details: string
  ): void {
    const ciError = this.errors.get(errorId);
    if (!ciError) {
      return;
    }

    ciError.resolved = true;
    ciError.resolution = {
      strategy,
      timestamp: new Date(),
      details
    };

    this.errors.set(errorId, ciError);
  }

  /**
   * Generate comprehensive error report
   */
  generateReport(): CIErrorReport {
    const errors = Array.from(this.errors.values());
    const timestamp = new Date();

    // Calculate summary
    const errorsByType: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};
    let resolvedErrors = 0;

    for (const error of errors) {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
      
      if (error.resolved) {
        resolvedErrors++;
      }
    }

    const report: CIErrorReport = {
      metadata: {
        reportId: this.generateReportId(),
        timestamp,
        environment: process.env.NODE_ENV || 'unknown',
        buildInfo: this.getBuildInfo(),
        systemInfo: this.getSystemContext()
      },
      summary: {
        totalErrors: errors.length,
        errorsByType,
        errorsBySeverity,
        resolvedErrors,
        unresolvedErrors: errors.length - resolvedErrors
      },
      errors: errors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
      recommendations: this.generateRecommendations(errors)
    };

    return report;
  }

  /**
   * Save report to file
   */
  async saveReport(format: 'json' | 'html' | 'markdown' = 'json'): Promise<string> {
    const report = this.generateReport();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ci-error-report-${timestamp}.${format}`;
    const filepath = join(this.reportDir, filename);

    let content: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(report, null, 2);
        break;
      case 'html':
        content = this.generateHTMLReport(report);
        break;
      case 'markdown':
        content = this.generateMarkdownReport(report);
        break;
      default:
        throw new Error(`Unsupported format: ${format}`);
    }

    if (this.enableFileOutput) {
      writeFileSync(filepath, content, 'utf8');
    }

    return filepath;
  }

  /**
   * Get error statistics
   */
  getStatistics(): {
    totalErrors: number;
    criticalErrors: number;
    unresolvedErrors: number;
    mostCommonType: string;
    mostCommonSeverity: string;
    averageRecoveryAttempts: number;
  } {
    const errors = Array.from(this.errors.values());
    
    if (errors.length === 0) {
      return {
        totalErrors: 0,
        criticalErrors: 0,
        unresolvedErrors: 0,
        mostCommonType: 'none',
        mostCommonSeverity: 'none',
        averageRecoveryAttempts: 0
      };
    }

    const criticalErrors = errors.filter(e => e.severity === 'critical').length;
    const unresolvedErrors = errors.filter(e => !e.resolved).length;
    
    // Find most common type and severity
    const typeCounts: Record<string, number> = {};
    const severityCounts: Record<string, number> = {};
    let totalRecoveryAttempts = 0;

    for (const error of errors) {
      typeCounts[error.type] = (typeCounts[error.type] || 0) + 1;
      severityCounts[error.severity] = (severityCounts[error.severity] || 0) + 1;
      totalRecoveryAttempts += error.recoveryAttempts.length;
    }

    const mostCommonType = Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';
    
    const mostCommonSeverity = Object.entries(severityCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none';

    return {
      totalErrors: errors.length,
      criticalErrors,
      unresolvedErrors,
      mostCommonType,
      mostCommonSeverity,
      averageRecoveryAttempts: totalRecoveryAttempts / errors.length
    };
  }

  /**
   * Clear all errors
   */
  clearErrors(): void {
    this.errors.clear();
  }

  /**
   * Get errors by criteria
   */
  getErrors(criteria?: {
    type?: CIError['type'];
    severity?: CIError['severity'];
    resolved?: boolean;
    since?: Date;
  }): CIError[] {
    let errors = Array.from(this.errors.values());

    if (criteria) {
      if (criteria.type) {
        errors = errors.filter(e => e.type === criteria.type);
      }
      
      if (criteria.severity) {
        errors = errors.filter(e => e.severity === criteria.severity);
      }
      
      if (criteria.resolved !== undefined) {
        errors = errors.filter(e => e.resolved === criteria.resolved);
      }
      
      if (criteria.since) {
        errors = errors.filter(e => e.timestamp >= criteria.since!);
      }
    }

    return errors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  // Private methods

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `error-${timestamp}-${random}`;
  }

  /**
   * Generate unique report ID
   */
  private generateReportId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `report-${timestamp}-${random}`;
  }

  /**
   * Get system context
   */
  private getSystemContext(): CIError['systemContext'] {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      cpu: process.arch
    };
  }

  /**
   * Get CI context
   */
  private getCIContext(): CIError['ciContext'] {
    return {
      buildId: process.env.GITHUB_RUN_ID || process.env.BUILD_ID || 'unknown',
      jobId: process.env.GITHUB_JOB || process.env.JOB_ID || 'unknown',
      branch: process.env.GITHUB_REF_NAME || process.env.BRANCH || 'unknown',
      commit: process.env.GITHUB_SHA || process.env.COMMIT_SHA || 'unknown',
      pr: process.env.GITHUB_PR_NUMBER || process.env.PR_NUMBER
    };
  }

  /**
   * Get build info
   */
  private getBuildInfo(): any {
    return {
      ci: process.env.CI === 'true',
      runner: process.env.GITHUB_ACTIONS ? 'github-actions' : 'unknown',
      workflow: process.env.GITHUB_WORKFLOW,
      runNumber: process.env.GITHUB_RUN_NUMBER,
      repository: process.env.GITHUB_REPOSITORY
    };
  }

  /**
   * Output error to console/file
   */
  private outputError(error: CIError): void {
    if (this.enableConsoleOutput) {
      const color = this.getSeverityColor(error.severity);
      const reset = '\x1b[0m';
      
      console.error(`${color}[CI ERROR ${error.severity.toUpperCase()}]${reset} ${error.message}`);
      
      if (error.testContext) {
        console.error(`  Test: ${error.testContext.testName} (${error.testContext.testFile})`);
      }
      
      if (error.databaseContext) {
        console.error(`  Database: ${error.databaseContext.connectionId}`);
      }
      
      if (error.stack) {
        console.error(`  Stack: ${error.stack.split('\n')[0]}`);
      }
    }
  }

  /**
   * Get color code for severity
   */
  private getSeverityColor(severity: CIError['severity']): string {
    switch (severity) {
      case 'critical': return '\x1b[41m'; // Red background
      case 'high': return '\x1b[31m'; // Red
      case 'medium': return '\x1b[33m'; // Yellow
      case 'low': return '\x1b[36m'; // Cyan
      default: return '\x1b[37m'; // White
    }
  }

  /**
   * Generate recommendations based on errors
   */
  private generateRecommendations(errors: CIError[]): string[] {
    const recommendations: string[] = [];
    const errorsByType = errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Database-specific recommendations
    if (errorsByType.database > 0) {
      recommendations.push('Consider increasing database connection timeout values');
      recommendations.push('Review database migration scripts for potential issues');
      recommendations.push('Check database connection pool configuration');
    }

    // Test-specific recommendations
    if (errorsByType.test > 0) {
      recommendations.push('Review test isolation and cleanup procedures');
      recommendations.push('Consider increasing test timeout values');
      recommendations.push('Check for race conditions in parallel test execution');
    }

    // Migration-specific recommendations
    if (errorsByType.migration > 0) {
      recommendations.push('Validate migration scripts before deployment');
      recommendations.push('Consider implementing migration rollback procedures');
      recommendations.push('Review migration dependency order');
    }

    // System-specific recommendations
    if (errorsByType.system > 0) {
      recommendations.push('Monitor system resource usage during tests');
      recommendations.push('Consider increasing CI runner resources');
      recommendations.push('Review system dependencies and versions');
    }

    // Critical errors
    const criticalErrors = errors.filter(e => e.severity === 'critical').length;
    if (criticalErrors > 0) {
      recommendations.push(`${criticalErrors} critical errors require immediate attention`);
    }

    // Unresolved errors
    const unresolvedErrors = errors.filter(e => !e.resolved).length;
    if (unresolvedErrors > 0) {
      recommendations.push(`${unresolvedErrors} unresolved errors may indicate systemic issues`);
    }

    return recommendations;
  }

  /**
   * Generate HTML report
   */
  private generateHTMLReport(report: CIErrorReport): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>CI Error Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .stat { background: #e9ecef; padding: 15px; border-radius: 5px; text-align: center; }
        .error { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
        .critical { border-left: 5px solid #dc3545; }
        .high { border-left: 5px solid #fd7e14; }
        .medium { border-left: 5px solid #ffc107; }
        .low { border-left: 5px solid #17a2b8; }
        .resolved { opacity: 0.6; }
        .recommendations { background: #d4edda; padding: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>CI Error Report</h1>
        <p>Generated: ${report.metadata.timestamp.toISOString()}</p>
        <p>Environment: ${report.metadata.environment}</p>
    </div>
    
    <div class="summary">
        <div class="stat">
            <h3>${report.summary.totalErrors}</h3>
            <p>Total Errors</p>
        </div>
        <div class="stat">
            <h3>${report.summary.unresolvedErrors}</h3>
            <p>Unresolved</p>
        </div>
        <div class="stat">
            <h3>${report.summary.resolvedErrors}</h3>
            <p>Resolved</p>
        </div>
    </div>
    
    <div class="recommendations">
        <h3>Recommendations</h3>
        <ul>
            ${report.recommendations.map(rec => `<li>${rec}</li>`).join('')}
        </ul>
    </div>
    
    <h2>Errors</h2>
    ${report.errors.map(error => `
        <div class="error ${error.severity} ${error.resolved ? 'resolved' : ''}">
            <h4>${error.message}</h4>
            <p><strong>Type:</strong> ${error.type} | <strong>Severity:</strong> ${error.severity} | <strong>Time:</strong> ${error.timestamp.toISOString()}</p>
            ${error.testContext ? `<p><strong>Test:</strong> ${error.testContext.testName}</p>` : ''}
            ${error.resolved ? `<p><strong>Resolved:</strong> ${error.resolution?.details}</p>` : ''}
        </div>
    `).join('')}
</body>
</html>`;
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdownReport(report: CIErrorReport): string {
    return `# CI Error Report

**Generated:** ${report.metadata.timestamp.toISOString()}  
**Environment:** ${report.metadata.environment}  
**Report ID:** ${report.metadata.reportId}

## Summary

- **Total Errors:** ${report.summary.totalErrors}
- **Resolved Errors:** ${report.summary.resolvedErrors}
- **Unresolved Errors:** ${report.summary.unresolvedErrors}

### Errors by Type
${Object.entries(report.summary.errorsByType).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

### Errors by Severity
${Object.entries(report.summary.errorsBySeverity).map(([severity, count]) => `- ${severity}: ${count}`).join('\n')}

## Recommendations

${report.recommendations.map(rec => `- ${rec}`).join('\n')}

## Errors

${report.errors.map(error => `
### ${error.message}

- **Type:** ${error.type}
- **Severity:** ${error.severity}
- **Time:** ${error.timestamp.toISOString()}
- **Status:** ${error.resolved ? 'Resolved' : 'Unresolved'}
${error.testContext ? `- **Test:** ${error.testContext.testName}` : ''}
${error.resolved ? `- **Resolution:** ${error.resolution?.details}` : ''}

`).join('')}`;
  }
}

/**
 * CI Error Reporter Factory
 */
export class CIErrorReporterFactory {
  /**
   * Create error reporter for CI environment
   */
  static createForCI(): CIErrorReporter {
    return new CIErrorReporter({
      reportDir: join(process.cwd(), 'ci-reports'),
      enableConsoleOutput: true,
      enableFileOutput: true,
      maxErrors: 500
    });
  }

  /**
   * Create error reporter for local development
   */
  static createForLocal(): CIErrorReporter {
    return new CIErrorReporter({
      reportDir: join(process.cwd(), 'test-reports'),
      enableConsoleOutput: true,
      enableFileOutput: false,
      maxErrors: 100
    });
  }

  /**
   * Create silent error reporter (for testing)
   */
  static createSilent(): CIErrorReporter {
    return new CIErrorReporter({
      enableConsoleOutput: false,
      enableFileOutput: false,
      maxErrors: 50
    });
  }
}