# Troubleshooting Guide

This guide helps you diagnose and resolve common issues in the Telegram History Bot project.

## Table of Contents

- [Development Environment Issues](#development-environment-issues)
- [Build and Compilation Issues](#build-and-compilation-issues)
- [Code Quality Issues](#code-quality-issues)
- [Testing Issues](#testing-issues)
- [Runtime Issues](#runtime-issues)
- [Database Issues](#database-issues)
- [API and Integration Issues](#api-and-integration-issues)
- [Performance Issues](#performance-issues)
- [Deployment Issues](#deployment-issues)
- [Debugging Tools](#debugging-tools)

## Development Environment Issues

### Node.js Version Issues

**Problem**: TypeScript compilation fails or dependencies don't install
```
Error: Unsupported Node.js version
```

**Solution**:
```bash
# Check Node.js version
node --version

# Install correct version (18.x or 20.x)
nvm install 20
nvm use 20

# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Package Installation Issues

**Problem**: npm install fails with permission errors
```
Error: EACCES: permission denied
```

**Solution**:
```bash
# Fix npm permissions (macOS/Linux)
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules

# Or use npx instead of global installs
npx wrangler --version

# Windows: Run as administrator or use WSL
```

### Git Hooks Not Working

**Problem**: Pre-commit hooks don't run
```
Warning: .husky/pre-commit not executable
```

**Solution**:
```bash
# Make hooks executable
chmod +x .husky/pre-commit

# Reinstall husky
npm uninstall husky
npm install husky --save-dev
npx husky install

# Test hook manually
.husky/pre-commit
```

## Build and Compilation Issues

### TypeScript Compilation Errors

**Problem**: Type errors in existing code
```
error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'string'
```

**Solution**:
```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
rm -rf .tsbuildinfo

# Check specific file
npx tsc --noEmit src/specific-file.ts

# Generate fresh types
npm run cf-typegen

# Check tsconfig.json settings
cat tsconfig.json
```

### ESLint Configuration Issues

**Problem**: ESLint rules conflict or don't load
```
Error: Failed to load config "@typescript-eslint/recommended"
```

**Solution**:
```bash
# Install missing dependencies
npm install @typescript-eslint/eslint-plugin @typescript-eslint/parser --save-dev

# Check ESLint configuration
npx eslint --print-config src/index.ts

# Test specific rules
npx eslint src/index.ts --rule "no-console: error"

# Reset ESLint cache
rm -rf .eslintcache
```

### Prettier Formatting Issues

**Problem**: Code formatting conflicts with ESLint
```
Error: Delete `⏎` (prettier/prettier)
```

**Solution**:
```bash
# Check Prettier configuration
npx prettier --check src/

# Format all files
npm run format

# Check for conflicts
npx eslint-config-prettier src/index.ts

# Update .prettierrc.js if needed
```

## Code Quality Issues

### Critical Linter Violations

**Problem**: Pre-commit hooks fail due to critical linter errors
```
Error: 5 critical linting violations found
✖ 5 problems (5 errors, 0 warnings)
```

**Solution**:
```bash
# Check what critical violations exist
npx eslint src --config .eslintrc.critical.js

# Fix unused variables automatically
npx ts-node scripts/fix-unused-variables.ts

# Fix other auto-fixable issues
npm run lint:fix

# Check specific critical rules
npx eslint src --config .eslintrc.critical.js --rule "no-unused-vars: error"

# Generate fix plan for complex issues
npx ts-node scripts/generate-fix-plan.ts
```

### Type Safety Issues

**Problem**: TypeScript 'any' types detected
```
Warning: Found 15 'any' type usages in codebase
```

**Solution**:
```bash
# Run type safety audit
npm run quality:type-audit

# View detailed report
cat type-safety-audit-report-summary.md

# Replace 'any' types automatically where possible
npx ts-node scripts/type-replacer.ts

# Track progress
npm run quality:track-progress

# Manual fixes for complex cases
# Edit files listed in type-safety-audit-report.json
```

### Pre-commit Hook Failures

**Problem**: Git commits blocked by quality checks
```
Error: Pre-commit hook failed
✖ Critical linting violations found
```

**Solution**:
```bash
# Check what's failing
npm run quality-check

# Fix linting issues
npm run lint:fix

# Fix formatting
npm run format

# Check TypeScript compilation
npm run type-check

# Validate fixes
npm run quality:validate-fixes

# Try commit again
git commit -m "fix: resolve quality issues"
```

### Quality Audit Failures

**Problem**: Quality audit reports issues
```
Quality Score: 65/100 (D)
- 12 critical linting violations
- 8 'any' type usages
- 3 failing tests
```

**Solution**:
```bash
# Generate comprehensive quality report
npm run quality:report

# View detailed breakdown
cat quality-metrics-report.md

# Fix issues systematically:

# 1. Fix critical linting
npx eslint src --config .eslintrc.critical.js --fix

# 2. Address type safety
npm run quality:type-audit
npx ts-node scripts/type-replacer.ts

# 3. Fix failing tests
npm test -- --reporter=verbose

# 4. Validate improvements
npm run quality:validate-fixes

# 5. Generate new report
npm run quality:report
```

### Test Database Issues

**Problem**: Test database setup fails
```
Error: Cannot setup test database
Database file is locked
```

**Solution**:
```bash
# Clean up existing test database
bash scripts/ci-database-teardown.sh

# Remove lock files
rm -f test.db test.db-shm test.db-wal

# Setup fresh test database
bash scripts/ci-database-setup.sh

# Verify setup
DATABASE_URL="file:./test.db" npm run test:database

# Check database health
npx ts-node tests/utils/database-health-monitor.ts
```

### MessageFormatter Test Failures

**Problem**: MessageFormatter tests are flaky
```
Error: MessageFormatter tests failing intermittently
Expected: "formatted message"
Received: "different formatted message"
```

**Solution**:
```bash
# Run MessageFormatter tests specifically
npm run test:message-formatter

# Use deterministic test data
# Check tests/fixtures/message-formatter-fixtures.ts

# Run with verbose output
npm test tests/message-formatter* -- --reporter=verbose

# Check test utilities
cat tests/utils/message-formatter-test-utils.ts

# Reset test environment
rm -rf coverage .vitest
npm test tests/message-formatter* -- --clearCache
```

### CI Quality Gate Failures

**Problem**: CI pipeline fails at quality gate
```
❌ Quality gate FAILED - 2 critical failures
- Quality checks failed
- Build test failed
```

**Solution**:
```bash
# Simulate CI checks locally
npm run quality-check
npm run test:coverage
npm run test:integration

# Check CI performance
npm run ci:performance

# View CI logs for specific failures
# Fix issues locally before pushing

# Validate fixes work in CI-like environment
DATABASE_URL="file:./test.db" npm run quality-audit
```

### Quality Metrics Regression

**Problem**: Quality metrics show regression
```
Warning: Quality metrics have regressed
- Linter violations increased from 5 to 12
- Test coverage decreased from 85% to 78%
```

**Solution**:
```bash
# Check quality trends
cat quality-metrics-history.json

# Compare with previous version
git diff HEAD~1 quality-metrics-summary.json

# Run regression prevention tests
npm test tests/integration/regression-prevention.test.ts

# Identify specific regressions
npm run quality:report

# Fix regressions systematically
npm run lint:fix
npm run test:coverage

# Validate improvements
npm run quality:track-progress
```

### Automated Fix Validation Failures

**Problem**: Automated fixes break functionality
```
Error: Validation failed after applying automated fixes
Tests are now failing that previously passed
```

**Solution**:
```bash
# Rollback automated fixes
npx ts-node scripts/rollback-fixes.ts

# Check what fixes were applied
cat fix-application-log.json

# Apply fixes incrementally
npx ts-node scripts/fix-unused-variables.ts --dry-run
npx ts-node scripts/fix-unused-variables.ts --file-by-file

# Validate each fix
npm test
npm run quality:validate-fixes

# Generate safer fix plan
npx ts-node scripts/generate-fix-plan.ts --conservative
```

### Performance Quality Issues

**Problem**: CI pipeline is too slow
```
Warning: CI pipeline taking > 10 minutes
Build time: 8 minutes
Test time: 5 minutes
```

**Solution**:
```bash
# Profile CI performance
npm run ci:performance

# Check performance metrics
cat ci-performance-report.md

# Optimize slow tests
npm run test:performance

# Parallelize where possible
# Check vitest.config.ts for parallel settings

# Cache optimization
# Verify CI cache configuration in .github/workflows/

# Monitor improvements
npm run ci:performance
```

## Testing Issues

### Test Failures

**Problem**: Tests fail unexpectedly
```
Error: Cannot find module '../src/services/user-service'
```

**Solution**:
```bash
# Clear test cache
npm test -- --clearCache

# Run specific test file
npm test src/services/user-service.test.ts

# Run with verbose output
npm test -- --reporter=verbose

# Check test configuration
cat vitest.config.ts
```

### Mock Issues

**Problem**: Mocks don't work correctly
```
Error: Cannot spy on a property that is not defined
```

**Solution**:
```typescript
// Ensure proper mock setup
import { vi } from 'vitest';

// Mock before importing the module
vi.mock('../src/services/user-service', () => ({
  UserService: vi.fn().mockImplementation(() => ({
    getUser: vi.fn().mockResolvedValue({ id: '1', name: 'Test' })
  }))
}));

// Import after mocking
import { UserService } from '../src/services/user-service';
```

### Database Test Issues

**Problem**: Database tests interfere with each other
```
Error: Database is locked
```

**Solution**:
```typescript
// Use test isolation
describe('UserRepository', () => {
  let testDb: D1Database;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    await seedTestData(testDb);
  });

  afterEach(async () => {
    await cleanupTestDatabase(testDb);
  });
});
```

## Runtime Issues

### Environment Variable Issues

**Problem**: Configuration not loaded
```
Error: TELEGRAM_BOT_TOKEN is not defined
```

**Solution**:
```bash
# Check environment variables
echo $TELEGRAM_BOT_TOKEN

# Load from .env file
source .env

# Check wrangler configuration
cat wrangler.jsonc

# Test locally
wrangler dev --local
```

### Memory Issues

**Problem**: Out of memory errors
```
Error: JavaScript heap out of memory
```

**Solution**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Check memory usage
node --inspect scripts/memory-check.js

# Profile memory leaks
node --inspect-brk --expose-gc scripts/profile.js
```

### Async/Await Issues

**Problem**: Unhandled promise rejections
```
UnhandledPromiseRejectionWarning: Error: Database connection failed
```

**Solution**:
```typescript
// Always handle promises
try {
  const result = await someAsyncOperation();
  return success(result);
} catch (error) {
  return failure(new DatabaseError('Operation failed', { error }));
}

// Use Result<T> pattern
const result = await ErrorHandler.handle(
  () => someAsyncOperation(),
  { operationName: 'fetchUser' }
);

if (ErrorHandler.isFailure(result)) {
  console.error('Operation failed:', result.error);
}
```

## Database Issues

### Connection Issues

**Problem**: Cannot connect to D1 database
```
Error: D1_ERROR: Database not found
```

**Solution**:
```bash
# Check database configuration
wrangler d1 list

# Create database if missing
wrangler d1 create telegram-history-bot

# Update wrangler.jsonc with correct database ID
# Run migrations
wrangler d1 migrations apply telegram-history-bot --local
```

### Migration Issues

**Problem**: Migration fails
```
Error: Migration 0001_init.sql failed
```

**Solution**:
```bash
# Check migration status
wrangler d1 migrations list telegram-history-bot

# Run specific migration
wrangler d1 execute telegram-history-bot --file=migrations/0001_init.sql

# Reset database (development only)
wrangler d1 execute telegram-history-bot --command="DROP TABLE IF EXISTS violations;"

# Recreate tables
wrangler d1 migrations apply telegram-history-bot --local
```

### Query Issues

**Problem**: SQL queries fail
```
Error: SQLITE_ERROR: no such table: violations
```

**Solution**:
```typescript
// Check table exists
const tables = await db.prepare(`
  SELECT name FROM sqlite_master 
  WHERE type='table' AND name='violations'
`).first();

if (!tables) {
  throw new DatabaseError('Table violations does not exist');
}

// Use proper error handling
const result = await ErrorHandler.handle(
  () => db.prepare('SELECT * FROM violations WHERE id = ?').bind(id).first(),
  { operationName: 'fetchViolation', context: { id } }
);
```

## API and Integration Issues

### Telegram API Issues

**Problem**: Webhook not receiving updates
```
Error: Webhook verification failed
```

**Solution**:
```bash
# Check webhook URL
curl -X GET "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Set webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-worker.your-subdomain.workers.dev/webhook"}'

# Test webhook locally
wrangler dev --local --port 8787
ngrok http 8787
```

### AI Provider Issues

**Problem**: OpenAI API calls fail
```
Error: 429 Too Many Requests
```

**Solution**:
```typescript
// Implement retry logic
const result = await ErrorHandler.handle(
  async () => {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
    });
    return response;
  },
  { 
    operationName: 'openaiRequest',
    retries: 3,
    backoff: 'exponential'
  }
);

// Check API key and quota
console.log('API Key:', process.env.OPENAI_API_KEY?.substring(0, 10) + '...');
```

### Rate Limiting Issues

**Problem**: API rate limits exceeded
```
Error: Rate limit exceeded
```

**Solution**:
```typescript
// Implement rate limiting
class RateLimiter {
  private requests: number[] = [];
  
  async checkLimit(maxRequests: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < windowMs);
    
    if (this.requests.length >= maxRequests) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  }
}

// Use exponential backoff
const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
await new Promise(resolve => setTimeout(resolve, delay));
```

## Performance Issues

### Slow Response Times

**Problem**: API responses are slow
```
Warning: Response time > 5000ms
```

**Solution**:
```typescript
// Add performance monitoring
const startTime = Date.now();

try {
  const result = await operation();
  const duration = Date.now() - startTime;
  
  if (duration > 1000) {
    console.warn(`Slow operation: ${duration}ms`);
  }
  
  return result;
} catch (error) {
  const duration = Date.now() - startTime;
  console.error(`Failed operation after ${duration}ms:`, error);
  throw error;
}

// Use caching
const cached = await cache.get(key);
if (cached) {
  return cached;
}

const result = await expensiveOperation();
await cache.set(key, result, { ttl: 300 }); // 5 minutes
return result;
```

### Memory Leaks

**Problem**: Memory usage keeps growing
```
Warning: Memory usage > 512MB
```

**Solution**:
```typescript
// Clean up resources
class DataProcessor {
  private cache = new Map();
  private timers: NodeJS.Timeout[] = [];

  async process(data: Data[]): Promise<void> {
    try {
      // Process data
    } finally {
      // Clean up
      this.cache.clear();
      this.timers.forEach(timer => clearTimeout(timer));
      this.timers = [];
    }
  }
}

// Use WeakMap for automatic cleanup
const cache = new WeakMap();

// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB'
  });
}, 30000);
```

## Deployment Issues

### Wrangler Deployment Fails

**Problem**: Deployment to Cloudflare Workers fails
```
Error: Authentication failed
```

**Solution**:
```bash
# Check authentication
wrangler auth list

# Login again
wrangler auth login

# Check account ID
wrangler whoami

# Update wrangler.jsonc
{
  "account_id": "your-account-id",
  "compatibility_date": "2024-01-01"
}

# Deploy with verbose output
wrangler deploy --verbose
```

### Environment Variables Not Set

**Problem**: Environment variables missing in production
```
Error: TELEGRAM_BOT_TOKEN is undefined
```

**Solution**:
```bash
# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put OPENAI_API_KEY

# List secrets
wrangler secret list

# Check environment in worker
console.log('Environment:', {
  hasToken: !!env.TELEGRAM_BOT_TOKEN,
  hasOpenAI: !!env.OPENAI_API_KEY
});
```

### Database Binding Issues

**Problem**: D1 database not accessible
```
Error: env.DB is undefined
```

**Solution**:
```bash
# Check wrangler.jsonc bindings
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "telegram-history-bot",
      "database_id": "your-database-id"
    }
  ]
}

# Test database connection
wrangler d1 execute telegram-history-bot --command="SELECT 1"
```

## Debugging Tools

### Logging and Monitoring

```typescript
// Structured logging
import { Logger } from './src/logger';

Logger.info('Processing user request', {
  userId: '123',
  operation: 'getStats',
  timestamp: new Date().toISOString()
});

Logger.error('Database operation failed', {
  error: error.message,
  query: 'SELECT * FROM users',
  correlationId: 'req-123'
});
```

### Performance Profiling

```typescript
// Performance measurement
console.time('database-query');
const result = await db.query('SELECT * FROM violations');
console.timeEnd('database-query');

// Memory profiling
const memBefore = process.memoryUsage();
await processLargeDataset();
const memAfter = process.memoryUsage();

console.log('Memory delta:', {
  rss: memAfter.rss - memBefore.rss,
  heapUsed: memAfter.heapUsed - memBefore.heapUsed
});
```

### Error Tracking

```typescript
// Error context
try {
  await riskyOperation();
} catch (error) {
  const contextualError = new DatabaseError('Operation failed', {
    originalError: error,
    context: {
      userId: '123',
      operation: 'updateUser',
      timestamp: new Date().toISOString()
    }
  });
  
  Logger.error('Contextual error', contextualError.toJSON());
  throw contextualError;
}
```

### Development Tools

```bash
# Real-time logs
wrangler tail

# Local development with debugging
wrangler dev --local --inspect

# Database inspection
wrangler d1 execute telegram-history-bot --command="SELECT * FROM violations LIMIT 5"

# KV storage inspection
wrangler kv:key list --binding=CACHE

# Performance testing
npm run test:performance
```

## Getting Help

### Self-Help Checklist

1. **Check the error message** - Often contains the solution
2. **Search the documentation** - Look in `docs/` directory
3. **Check recent changes** - Use `git log` to see what changed
4. **Run diagnostics** - Use `npm run verify-system`
5. **Check environment** - Verify all required variables are set

### Escalation Process

1. **Search existing issues** in the repository
2. **Check team chat** for similar problems
3. **Create a detailed issue** with:
   - Error message and stack trace
   - Steps to reproduce
   - Environment information
   - What you've already tried
4. **Tag relevant team members** for urgent issues

### Useful Commands

```bash
# System diagnostics
npm run verify-system
npm run health-check

# Clean slate
rm -rf node_modules .wrangler coverage
npm install
npm run quality-check

# Debug information
node --version
npm --version
wrangler --version
git status
git log --oneline -5
```

Remember: Most issues have been encountered before. Check the documentation, search for similar problems, and don't hesitate to ask for help! 🚀