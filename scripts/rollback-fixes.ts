#!/usr/bin/env tsx

/**
 * Rollback Mechanism for Automated Fixes
 * Provides safe rollback functionality for automated code fixes
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';

interface BackupInfo {
  /** Backup timestamp */
  timestamp: Date;
  /** Backup directory */
  backupDir: string;
  /** Files backed up */
  files: string[];
  /** Backup metadata */
  metadata: {
    reason: string;
    originalCommand: string;
    filesModified: number;
    backupSize: number;
  };
}

interface RollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Files restored */
  filesRestored: string[];
  /** Files that failed to restore */
  failedFiles: string[];
  /** Error messages */
  errors: string[];
  /** Rollback time in milliseconds */
  rollbackTime: number;
}

/**
 * Rollback Manager
 */
class RollbackManager {
  private projectRoot: string;
  private backupBaseDir: string;

  constructor(backupBaseDir?: string) {
    this.projectRoot = process.cwd();
    this.backupBaseDir = backupBaseDir || join(this.projectRoot, '.backup');
  }

  /**
   * Create backup before making changes
   */
  async createBackup(
    files: string[],
    reason: string,
    originalCommand: string = ''
  ): Promise<BackupInfo> {
    console.log('💾 Creating backup...');
    
    const timestamp = new Date();
    const backupDirName = `backup-${timestamp.toISOString().replace(/[:.]/g, '-')}`;
    const backupDir = join(this.backupBaseDir, backupDirName);

    // Create backup directory
    execSync(`mkdir -p "${backupDir}"`, { cwd: this.projectRoot });

    let totalSize = 0;
    const backedUpFiles: string[] = [];

    // Copy files to backup
    for (const file of files) {
      try {
        const sourcePath = join(this.projectRoot, file);
        const backupPath = join(backupDir, file);
        const backupFileDir = join(backupDir, file.split('/').slice(0, -1).join('/'));

        // Create directory structure
        if (backupFileDir !== backupDir) {
          execSync(`mkdir -p "${backupFileDir}"`, { cwd: this.projectRoot });
        }

        // Copy file
        execSync(`cp "${sourcePath}" "${backupPath}"`, { cwd: this.projectRoot });
        
        // Track size
        const stats = statSync(sourcePath);
        totalSize += stats.size;
        backedUpFiles.push(file);
      } catch (error) {
        console.warn(`⚠️  Failed to backup ${file}:`, error);
      }
    }

    // Create backup metadata
    const backupInfo: BackupInfo = {
      timestamp,
      backupDir,
      files: backedUpFiles,
      metadata: {
        reason,
        originalCommand,
        filesModified: backedUpFiles.length,
        backupSize: totalSize
      }
    };

    // Save backup metadata
    const metadataPath = join(backupDir, 'backup-info.json');
    writeFileSync(metadataPath, JSON.stringify(backupInfo, null, 2));

    console.log(`💾 Backup created: ${backupDir}`);
    console.log(`📁 Backed up ${backedUpFiles.length} files (${this.formatBytes(totalSize)})`);

    return backupInfo;
  }

  /**
   * List available backups
   */
  listBackups(): BackupInfo[] {
    if (!existsSync(this.backupBaseDir)) {
      return [];
    }

    const backups: BackupInfo[] = [];
    const backupDirs = readdirSync(this.backupBaseDir)
      .filter(dir => dir.startsWith('backup-'))
      .sort()
      .reverse(); // Most recent first

    for (const backupDir of backupDirs) {
      try {
        const metadataPath = join(this.backupBaseDir, backupDir, 'backup-info.json');
        if (existsSync(metadataPath)) {
          const backupInfo = JSON.parse(readFileSync(metadataPath, 'utf8'));
          backupInfo.timestamp = new Date(backupInfo.timestamp);
          backupInfo.backupDir = join(this.backupBaseDir, backupDir);
          backups.push(backupInfo);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to read backup metadata for ${backupDir}:`, error);
      }
    }

    return backups;
  }

  /**
   * Rollback to a specific backup
   */
  async rollback(backupInfo: BackupInfo, options: {
    dryRun?: boolean;
    selective?: string[];
  } = {}): Promise<RollbackResult> {
    console.log(`🔄 Rolling back to backup from ${backupInfo.timestamp.toLocaleString()}...`);
    
    if (options.dryRun) {
      console.log('🔍 Running in DRY RUN mode - no files will be modified');
    }

    const startTime = Date.now();
    const result: RollbackResult = {
      success: true,
      filesRestored: [],
      failedFiles: [],
      errors: [],
      rollbackTime: 0
    };

    // Determine which files to restore
    const filesToRestore = options.selective 
      ? backupInfo.files.filter(file => options.selective!.includes(file))
      : backupInfo.files;

    console.log(`📁 Restoring ${filesToRestore.length} files...`);

    // Restore files
    for (const file of filesToRestore) {
      try {
        const backupPath = join(backupInfo.backupDir, file);
        const targetPath = join(this.projectRoot, file);

        if (!existsSync(backupPath)) {
          result.errors.push(`Backup file not found: ${backupPath}`);
          result.failedFiles.push(file);
          continue;
        }

        if (!options.dryRun) {
          // Create target directory if needed
          const targetDir = join(this.projectRoot, file.split('/').slice(0, -1).join('/'));
          if (targetDir !== this.projectRoot) {
            execSync(`mkdir -p "${targetDir}"`, { cwd: this.projectRoot });
          }

          // Copy file back
          execSync(`cp "${backupPath}" "${targetPath}"`, { cwd: this.projectRoot });
        }

        result.filesRestored.push(file);
        
        if (options.dryRun) {
          console.log(`🔍 Would restore: ${file}`);
        } else {
          console.log(`✅ Restored: ${file}`);
        }
      } catch (error) {
        const errorMsg = `Failed to restore ${file}: ${(error as Error).message}`;
        result.errors.push(errorMsg);
        result.failedFiles.push(file);
        console.warn(`⚠️  ${errorMsg}`);
      }
    }

    result.rollbackTime = Date.now() - startTime;
    result.success = result.failedFiles.length === 0;

    if (result.success) {
      console.log(`✅ Rollback completed successfully in ${result.rollbackTime}ms`);
    } else {
      console.log(`⚠️  Rollback completed with ${result.failedFiles.length} failures`);
    }

    return result;
  }

  /**
   * Rollback to the most recent backup
   */
  async rollbackToLatest(options: {
    dryRun?: boolean;
    selective?: string[];
  } = {}): Promise<RollbackResult> {
    const backups = this.listBackups();
    
    if (backups.length === 0) {
      throw new Error('No backups found');
    }

    const latestBackup = backups[0];
    console.log(`🔄 Rolling back to latest backup: ${latestBackup.metadata.reason}`);
    
    return this.rollback(latestBackup, options);
  }

  /**
   * Clean up old backups
   */
  async cleanupBackups(options: {
    keepCount?: number;
    olderThanDays?: number;
    dryRun?: boolean;
  } = {}): Promise<{
    removed: string[];
    kept: string[];
    errors: string[];
  }> {
    const { keepCount = 10, olderThanDays = 30, dryRun = false } = options;
    
    console.log('🧹 Cleaning up old backups...');
    
    if (dryRun) {
      console.log('🔍 Running in DRY RUN mode - no backups will be deleted');
    }

    const backups = this.listBackups();
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (olderThanDays * 24 * 60 * 60 * 1000));

    const removed: string[] = [];
    const kept: string[] = [];
    const errors: string[] = [];

    // Sort backups by timestamp (newest first)
    const sortedBackups = [...backups].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    for (let i = 0; i < sortedBackups.length; i++) {
      const backup = sortedBackups[i];
      const backupDirName = backup.backupDir.split('/').pop() || '';
      
      // Keep recent backups based on count
      if (i < keepCount) {
        kept.push(backupDirName);
        continue;
      }

      // Keep backups newer than cutoff date
      if (backup.timestamp > cutoffDate) {
        kept.push(backupDirName);
        continue;
      }

      // Remove old backup
      try {
        if (!dryRun) {
          execSync(`rm -rf "${backup.backupDir}"`, { cwd: this.projectRoot });
        }
        
        removed.push(backupDirName);
        
        if (dryRun) {
          console.log(`🔍 Would remove: ${backupDirName}`);
        } else {
          console.log(`🗑️  Removed: ${backupDirName}`);
        }
      } catch (error) {
        const errorMsg = `Failed to remove ${backupDirName}: ${(error as Error).message}`;
        errors.push(errorMsg);
        console.warn(`⚠️  ${errorMsg}`);
      }
    }

    console.log(`🧹 Cleanup completed: ${removed.length} removed, ${kept.length} kept`);

    return { removed, kept, errors };
  }

  /**
   * Get backup statistics
   */
  getBackupStats(): {
    totalBackups: number;
    totalSize: number;
    oldestBackup?: Date;
    newestBackup?: Date;
    backupsByReason: Record<string, number>;
  } {
    const backups = this.listBackups();
    
    if (backups.length === 0) {
      return {
        totalBackups: 0,
        totalSize: 0,
        backupsByReason: {}
      };
    }

    const totalSize = backups.reduce((sum, backup) => sum + backup.metadata.backupSize, 0);
    const timestamps = backups.map(b => b.timestamp);
    const oldestBackup = new Date(Math.min(...timestamps.map(t => t.getTime())));
    const newestBackup = new Date(Math.max(...timestamps.map(t => t.getTime())));
    
    const backupsByReason = backups.reduce((acc, backup) => {
      const reason = backup.metadata.reason;
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalBackups: backups.length,
      totalSize,
      oldestBackup,
      newestBackup,
      backupsByReason
    };
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupInfo: BackupInfo): Promise<{
    valid: boolean;
    missingFiles: string[];
    corruptedFiles: string[];
    errors: string[];
  }> {
    console.log(`🔍 Verifying backup integrity...`);
    
    const missingFiles: string[] = [];
    const corruptedFiles: string[] = [];
    const errors: string[] = [];

    for (const file of backupInfo.files) {
      try {
        const backupPath = join(backupInfo.backupDir, file);
        
        if (!existsSync(backupPath)) {
          missingFiles.push(file);
          continue;
        }

        // Basic corruption check - try to read the file
        readFileSync(backupPath, 'utf8');
      } catch (error) {
        if (error && (error as any).code === 'ENOENT') {
          missingFiles.push(file);
        } else {
          corruptedFiles.push(file);
          errors.push(`${file}: ${(error as Error).message}`);
        }
      }
    }

    const valid = missingFiles.length === 0 && corruptedFiles.length === 0;
    
    if (valid) {
      console.log('✅ Backup integrity verified');
    } else {
      console.log(`⚠️  Backup integrity issues: ${missingFiles.length} missing, ${corruptedFiles.length} corrupted`);
    }

    return {
      valid,
      missingFiles,
      corruptedFiles,
      errors
    };
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const dryRun = args.includes('--dry-run');

  const rollbackManager = new RollbackManager();

  try {
    switch (command) {
      case 'list':
        const backups = rollbackManager.listBackups();
        console.log(`\n📋 Available Backups (${backups.length}):\n`);
        
        if (backups.length === 0) {
          console.log('No backups found.');
          break;
        }

        backups.forEach((backup, index) => {
          console.log(`${index + 1}. ${backup.timestamp.toLocaleString()}`);
          console.log(`   Reason: ${backup.metadata.reason}`);
          console.log(`   Files: ${backup.files.length}`);
          console.log(`   Size: ${rollbackManager['formatBytes'](backup.metadata.backupSize)}`);
          console.log(`   Directory: ${backup.backupDir}`);
          console.log('');
        });
        break;

      case 'rollback':
        const backupIndex = parseInt(args[1]) - 1;
        const selective = args.includes('--files') 
          ? args[args.indexOf('--files') + 1]?.split(',')
          : undefined;

        if (args[1] === 'latest') {
          const result = await rollbackManager.rollbackToLatest({ dryRun, selective });
          console.log(`\n📊 Rollback Result:`);
          console.log(`   Success: ${result.success ? '✅' : '❌'}`);
          console.log(`   Files restored: ${result.filesRestored.length}`);
          console.log(`   Failed files: ${result.failedFiles.length}`);
          console.log(`   Time: ${result.rollbackTime}ms`);
        } else if (!isNaN(backupIndex)) {
          const availableBackups = rollbackManager.listBackups();
          if (backupIndex < 0 || backupIndex >= availableBackups.length) {
            console.error('❌ Invalid backup index');
            process.exit(1);
          }

          const backup = availableBackups[backupIndex];
          const result = await rollbackManager.rollback(backup, { dryRun, selective });
          console.log(`\n📊 Rollback Result:`);
          console.log(`   Success: ${result.success ? '✅' : '❌'}`);
          console.log(`   Files restored: ${result.filesRestored.length}`);
          console.log(`   Failed files: ${result.failedFiles.length}`);
          console.log(`   Time: ${result.rollbackTime}ms`);
        } else {
          console.error('❌ Please specify backup index or "latest"');
          process.exit(1);
        }
        break;

      case 'cleanup':
        const keepCount = args.includes('--keep') 
          ? parseInt(args[args.indexOf('--keep') + 1]) 
          : 10;
        const olderThanDays = args.includes('--older-than') 
          ? parseInt(args[args.indexOf('--older-than') + 1]) 
          : 30;

        const cleanupResult = await rollbackManager.cleanupBackups({
          keepCount,
          olderThanDays,
          dryRun
        });

        console.log(`\n📊 Cleanup Result:`);
        console.log(`   Removed: ${cleanupResult.removed.length}`);
        console.log(`   Kept: ${cleanupResult.kept.length}`);
        console.log(`   Errors: ${cleanupResult.errors.length}`);
        break;

      case 'stats':
        const stats = rollbackManager.getBackupStats();
        console.log(`\n📊 Backup Statistics:`);
        console.log(`   Total backups: ${stats.totalBackups}`);
        console.log(`   Total size: ${rollbackManager['formatBytes'](stats.totalSize)}`);
        
        if (stats.oldestBackup && stats.newestBackup) {
          console.log(`   Oldest: ${stats.oldestBackup.toLocaleString()}`);
          console.log(`   Newest: ${stats.newestBackup.toLocaleString()}`);
        }
        
        console.log(`\n📋 Backups by reason:`);
        Object.entries(stats.backupsByReason).forEach(([reason, count]) => {
          console.log(`   ${reason}: ${count}`);
        });
        break;

      case 'verify':
        const verifyIndex = parseInt(args[1]) - 1;
        const availableBackups = rollbackManager.listBackups();
        
        if (isNaN(verifyIndex) || verifyIndex < 0 || verifyIndex >= availableBackups.length) {
          console.error('❌ Please specify a valid backup index');
          process.exit(1);
        }

        const backupToVerify = availableBackups[verifyIndex];
        const verifyResult = await rollbackManager.verifyBackup(backupToVerify);
        
        console.log(`\n📊 Verification Result:`);
        console.log(`   Valid: ${verifyResult.valid ? '✅' : '❌'}`);
        console.log(`   Missing files: ${verifyResult.missingFiles.length}`);
        console.log(`   Corrupted files: ${verifyResult.corruptedFiles.length}`);
        
        if (verifyResult.errors.length > 0) {
          console.log(`\n❌ Errors:`);
          verifyResult.errors.forEach(error => console.log(`   ${error}`));
        }
        break;

      default:
        console.log(`
Usage: tsx rollback-fixes.ts <command> [options]

Commands:
  list                    List available backups
  rollback <index|latest> Rollback to specific backup or latest
  cleanup                 Clean up old backups
  stats                   Show backup statistics
  verify <index>          Verify backup integrity

Options:
  --dry-run              Show what would be done without making changes
  --files <file1,file2>  Rollback only specific files (for rollback command)
  --keep <count>         Number of backups to keep (for cleanup command)
  --older-than <days>    Remove backups older than N days (for cleanup command)

Examples:
  tsx rollback-fixes.ts list
  tsx rollback-fixes.ts rollback latest --dry-run
  tsx rollback-fixes.ts rollback 1 --files src/file1.ts,src/file2.ts
  tsx rollback-fixes.ts cleanup --keep 5 --older-than 14
  tsx rollback-fixes.ts verify 1
        `);
        process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Command failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { RollbackManager, type BackupInfo, type RollbackResult };