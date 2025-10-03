# Developer Guidelines

Welcome to the Telegram History Bot project! This guide will help you get started with development and maintain consistency across the codebase.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Code Quality Standards](#code-quality-standards)
- [Coding Standards](#coding-standards)
- [Development Workflow](#development-workflow)
- [Testing Guidelines](#testing-guidelines)
- [Quality Assurance](#quality-assurance)
- [Documentation Standards](#documentation-standards)
- [Performance Guidelines](#performance-guidelines)
- [Security Guidelines](#security-guidelines)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

- **Node.js**: Version 18.x or 20.x
- **npm**: Version 8.x or higher
- **Git**: Latest version
- **Cloudflare Account**: For deployment and testing
- **TypeScript**: Familiarity with TypeScript development

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd telegram-history-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Install Git hooks**
   ```bash
   npx husky install
   ```

5. **Verify setup**
   ```bash
   npm run quality-check
   ```

### First-Time Development

1. **Run type generation**
   ```bash
   npm run cf-typegen
   ```

2. **Start development server**
   ```bash
   npm run dev
   ```

3. **Run tests**
   ```bash
   npm test
   ```

4. **Check code quality**
   ```bash
   npm run quality-check
   npm run quality-audit
   ```

5. **Set up test database**
   ```bash
   # For local development
   export DATABASE_URL="file:./test.db"
   npm run test:database
   ```

## Development Environment

### Required Tools

- **IDE**: VS Code (recommended) or WebStorm
- **Extensions** (VS Code):
  - TypeScript and JavaScript Language Features
  - ESLint
  - Prettier - Code formatter
  - GitLens
  - Thunder Client (for API testing)
  - Cloudflare Workers (optional)

### VS Code Configuration

Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "typescript.suggest.autoImports": true,
  "files.exclude": {
    "node_modules": true,
    ".wrangler": true,
    "coverage": true
  }
}
```

### Environment Variables

Required environment variables:
```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret

# Cloudflare Configuration
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token

# AI Provider Configuration
OPENAI_API_KEY=your_openai_key
CLOUDFLARE_AI_GATEWAY_URL=your_gateway_url

# Database Configuration
DATABASE_URL=your_d1_database_url
KV_NAMESPACE=your_kv_namespace

# Optional Configuration
LOG_LEVEL=info
ENVIRONMENT=development
```

## Project Structure

```
telegram-history-bot/
├── .github/                 # GitHub workflows and templates
├── .husky/                  # Git hooks
├── .kiro/                   # Kiro AI assistant configuration
├── .wrangler/               # Cloudflare Workers build output
├── docs/                    # Documentation
├── migrations/              # Database migrations
├── node_modules/            # Dependencies
├── scripts/                 # Build and utility scripts
├── src/                     # Source code
│   ├── models/             # Data models and interfaces
│   ├── providers/          # AI provider implementations
│   ├── repositories/       # Data access layer
│   ├── services/           # Business logic layer
│   ├── utils/              # Utility functions
│   ├── consts.ts           # Application constants
│   ├── env.ts              # Environment configuration
│   ├── index.ts            # Main entry point
│   └── ...                 # Other core files
├── tests/                   # Test files
│   ├── fixtures/           # Test data and fixtures
│   ├── integration/        # Integration tests
│   ├── mocks/              # Mock implementations
│   ├── unit/               # Unit tests
│   └── utils/              # Test utilities
├── .eslintrc.js            # ESLint configuration
├── .prettierrc.js          # Prettier configuration
├── package.json            # Project configuration
├── tsconfig.json           # TypeScript configuration
├── vitest.config.ts        # Test configuration
└── wrangler.jsonc          # Cloudflare Workers configuration
```

### Key Directories

- **`src/models/`**: TypeScript interfaces and types
- **`src/services/`**: Business logic and service layer
- **`src/repositories/`**: Data access and persistence
- **`src/providers/`**: External service integrations
- **`src/utils/`**: Shared utility functions
- **`tests/`**: All test files organized by type
- **`scripts/`**: Quality assurance and automation scripts
- **`docs/`**: Project documentation and guidelines

## Code Quality Standards

Our project maintains high code quality through automated tools and processes. All code must pass quality gates before being merged.

### Quality Gates

1. **Critical Linter Checks** (Build Breaking)
   - No unused variables
   - No undefined variables
   - No unreachable code
   - No duplicate keys
   - Security rule compliance

2. **Type Safety Requirements**
   - Zero TypeScript compilation errors
   - Minimal 'any' type usage (< 10 instances)
   - Proper type definitions for all APIs
   - Runtime type validation for external data

3. **Test Requirements**
   - All tests must pass
   - Minimum 80% code coverage
   - MessageFormatter tests must be reliable
   - Integration tests for critical paths

4. **Performance Standards**
   - Build time < 2 minutes
   - Test execution < 5 minutes
   - No memory leaks in long-running processes

### Quality Tools

#### Linting and Formatting

```bash
# Run all linter checks
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Critical linter check (build-breaking)
npx eslint src --config .eslintrc.critical.js --max-warnings 0

# Security linting
npx eslint src --config .eslintrc.security.js

# Format code
npm run format
```

#### Type Safety

```bash
# Type safety audit
npm run quality:type-audit

# TypeScript compilation check
npm run type-check

# Track type improvements
npm run quality:track-progress
```

#### Quality Auditing

```bash
# Comprehensive quality audit
npm run quality-audit

# Linter violation audit
npm run quality:linter-audit

# Validate automated fixes
npm run quality:validate-fixes

# Generate quality report
npm run quality:report
```

### Pre-commit Quality Checks

Our pre-commit hooks automatically run:

1. **Critical ESLint rules** - Prevents commits with critical issues
2. **TypeScript compilation** - Ensures code compiles
3. **Prettier formatting** - Maintains consistent code style
4. **Import organization** - Keeps imports clean

If pre-commit checks fail:
```bash
# Fix linting issues
npm run lint:fix

# Fix formatting
npm run format

# Check what's failing
npm run quality-check
```

### Continuous Integration Quality Gates

Our CI pipeline includes:

1. **Setup Phase**
   - Test database initialization
   - Dependency installation
   - Environment validation

2. **Quality Checks Phase**
   - Type safety audit
   - Critical linter checks
   - Full linter analysis
   - Code formatting validation

3. **Testing Phase**
   - Unit tests
   - Integration tests
   - MessageFormatter tests
   - Coverage reporting

4. **Quality Gate Phase**
   - Critical failure detection
   - Performance monitoring
   - Quality metrics reporting

### Quality Metrics Tracking

We track quality metrics over time:

```bash
# Generate current quality report
npm run quality:report

# View quality trends
cat quality-metrics-report.md

# Check CI performance
npm run ci:performance
```

Key metrics tracked:
- Linter violations (critical vs warning)
- TypeScript 'any' type usage
- Test coverage percentage
- Build and test performance
- Code complexity metrics

### Automated Quality Fixes

Some quality issues can be automatically fixed:

```bash
# Fix unused variables (prefixes with _)
npx ts-node scripts/fix-unused-variables.ts

# Replace 'any' types with proper types
npx ts-node scripts/type-replacer.ts

# Generate fix plan for complex issues
npx ts-node scripts/generate-fix-plan.ts

# Validate that fixes don't break functionality
npm run quality:validate-fixes
```

### Quality Standards Enforcement

#### For New Code
- Must pass all quality gates
- Zero critical linter violations
- Proper TypeScript types (no 'any')
- Comprehensive test coverage
- Performance within acceptable limits

#### For Existing Code
- Gradual improvement approach
- No regression in quality metrics
- Automated fixes where possible
- Manual review for complex changes

#### For Dependencies
- Regular security audits
- License compliance checks
- Performance impact assessment
- Compatibility verification

## Coding Standards

### TypeScript Guidelines

1. **Use strict TypeScript**
   ```typescript
   // Good
   function processUser(user: User): Result<ProcessedUser> {
     // Implementation
   }

   // Bad
   function processUser(user: any): any {
     // Implementation
   }
   ```

2. **Prefer interfaces over types for object shapes**
   ```typescript
   // Good
   interface UserConfig {
     id: string;
     name: string;
     settings: UserSettings;
   }

   // Bad
   type UserConfig = {
     id: string;
     name: string;
     settings: UserSettings;
   }
   ```

3. **Use Result<T> pattern for error handling**
   ```typescript
   // Good
   async function fetchUser(id: string): Promise<Result<User>> {
     try {
       const user = await userRepository.findById(id);
       return success(user);
     } catch (error) {
       return failure(new DatabaseError('User not found', { userId: id }));
     }
   }

   // Bad
   async function fetchUser(id: string): Promise<User> {
     const user = await userRepository.findById(id); // Can throw
     return user;
   }
   ```

### Naming Conventions

- **Files**: kebab-case (`user-service.ts`)
- **Classes**: PascalCase (`UserService`)
- **Functions**: camelCase (`getUserById`)
- **Variables**: camelCase (`userId`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`)
- **Interfaces**: PascalCase with 'I' prefix for service interfaces (`IUserService`)
- **Types**: PascalCase (`UserRole`)
- **Enums**: PascalCase (`SeverityLevel`)

### Code Organization

1. **Import order**
   ```typescript
   // 1. Node.js built-ins
   import { readFile } from 'fs/promises';

   // 2. External libraries
   import { z } from 'zod';

   // 3. Internal modules (absolute imports)
   import { UserService } from '../services/user-service';

   // 4. Relative imports
   import { validateInput } from './validation';
   ```

2. **Function organization**
   ```typescript
   export class UserService {
     // 1. Static properties
     private static readonly DEFAULT_TIMEOUT = 5000;

     // 2. Instance properties
     private readonly repository: IUserRepository;

     // 3. Constructor
     constructor(repository: IUserRepository) {
       this.repository = repository;
     }

     // 4. Public methods
     public async getUser(id: string): Promise<Result<User>> {
       // Implementation
     }

     // 5. Private methods
     private validateUserId(id: string): boolean {
       // Implementation
     }
   }
   ```

### Error Handling

1. **Use Result<T> pattern**
   ```typescript
   // Good
   const result = await userService.getUser(id);
   if (ErrorHandler.isFailure(result)) {
     return failure(result.error);
   }
   const user = result.data;

   // Bad
   try {
     const user = await userService.getUser(id);
   } catch (error) {
     // Handle error
   }
   ```

2. **Create specific error types**
   ```typescript
   // Good
   throw new ValidationError('Invalid user ID', {
     field: 'userId',
     value: id,
     rule: 'required'
   });

   // Bad
   throw new Error('Invalid user ID');
   ```

## Development Workflow

### Branch Strategy

- **`main`**: Production-ready code
- **`develop`**: Integration branch for features
- **`feature/feature-name`**: Feature development
- **`bugfix/bug-description`**: Bug fixes
- **`hotfix/critical-fix`**: Critical production fixes

### Commit Messages

Follow conventional commits format:
```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/tooling changes

Examples:
```
feat(auth): add user authentication service
fix(database): resolve connection timeout issue
docs(api): update endpoint documentation
refactor(utils): simplify validation logic
```

### Pull Request Process

1. **Create feature branch**
   ```bash
   git checkout -b feature/user-authentication
   ```

2. **Make changes and commit**
   ```bash
   git add .
   git commit -m "feat(auth): implement user authentication"
   ```

3. **Run quality checks**
   ```bash
   npm run quality-check
   ```

4. **Push and create PR**
   ```bash
   git push origin feature/user-authentication
   ```

5. **PR Requirements**
   - [ ] Clear title and description
   - [ ] All tests pass
   - [ ] Code review completed
   - [ ] Documentation updated
   - [ ] No merge conflicts

### Daily Development

1. **Start of day**
   ```bash
   git pull origin develop
   npm install  # If package.json changed
   npm run quality-check
   ```

2. **During development**
   ```bash
   npm run dev          # Start development server
   npm run test:watch   # Run tests in watch mode
   npm run lint:fix     # Fix linting issues
   npm run format       # Format code
   ```

3. **Before committing**
   ```bash
   npm run quality-check  # Full quality check
   git add .
   git commit -m "feat: add new feature"
   ```

## Testing Guidelines

### Test Structure

```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockRepository: jest.Mocked<IUserRepository>;

  beforeEach(() => {
    mockRepository = createMockUserRepository();
    userService = new UserService(mockRepository);
  });

  describe('getUser', () => {
    it('should return user when found', async () => {
      // Arrange
      const userId = '123';
      const expectedUser = createTestUser({ id: userId });
      mockRepository.findById.mockResolvedValue(success(expectedUser));

      // Act
      const result = await userService.getUser(userId);

      // Assert
      expect(ErrorHandler.isSuccess(result)).toBe(true);
      expect(result.data).toEqual(expectedUser);
    });

    it('should return error when user not found', async () => {
      // Arrange
      const userId = '999';
      mockRepository.findById.mockResolvedValue(
        failure(new DatabaseError('User not found'))
      );

      // Act
      const result = await userService.getUser(userId);

      // Assert
      expect(ErrorHandler.isFailure(result)).toBe(true);
      expect(result.error.code).toBe('DATABASE_ERROR');
    });
  });
});
```

### Test Categories

1. **Unit Tests**: Test individual functions/classes
2. **Integration Tests**: Test component interactions
3. **End-to-End Tests**: Test complete workflows
4. **Performance Tests**: Test performance characteristics

### Test Commands

```bash
npm test                    # Run all tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Run tests with coverage
npm run test:integration   # Run integration tests only
npm run test:performance   # Run performance tests
```

## Quality Assurance

### Test Database Infrastructure

Our testing infrastructure includes dedicated test database management:

#### Test Database Setup

```bash
# Setup test database for local development
bash scripts/ci-database-setup.sh

# Run tests with test database
DATABASE_URL="file:./test.db" npm test

# Cleanup test database
bash scripts/ci-database-teardown.sh
```

#### Test Isolation

Each test suite runs in isolation:

```typescript
import { TestDatabaseManager } from '../utils/test-database-manager';
import { TestIsolationManager } from '../utils/test-isolation-manager';

describe('UserService Integration', () => {
  let dbManager: TestDatabaseManager;
  let isolation: TestIsolationManager;

  beforeEach(async () => {
    dbManager = new TestDatabaseManager();
    isolation = new TestIsolationManager();
    
    await dbManager.setupTestDatabase();
    await isolation.isolateTest('user-service-test');
  });

  afterEach(async () => {
    await isolation.cleanup();
    await dbManager.cleanupTestDatabase();
  });

  // Tests here run in complete isolation
});
```

#### Test Data Management

```bash
# Generate test fixtures
npx ts-node tests/utils/test-fixture-manager.ts

# Seed test data
npx ts-node tests/utils/database-seeding.ts

# Validate test data integrity
npx ts-node tests/utils/test-database-config.ts
```

### MessageFormatter Test Reliability

Special attention to MessageFormatter tests due to their complexity:

#### Deterministic Testing

```typescript
// Good: Deterministic test data
const testMessage = createTestMessage({
  id: 'test-123',
  timestamp: new Date('2024-01-01T00:00:00Z'),
  content: 'Test message content'
});

// Bad: Random test data
const testMessage = createTestMessage({
  id: Math.random().toString(),
  timestamp: new Date(),
  content: generateRandomString()
});
```

#### Test Utilities

```typescript
import { MessageFormatterTestUtils } from '../utils/message-formatter-test-utils';
import { MessageFormatterFixtures } from '../fixtures/message-formatter-fixtures';

describe('MessageFormatter', () => {
  const testUtils = new MessageFormatterTestUtils();
  const fixtures = new MessageFormatterFixtures();

  it('should format message consistently', () => {
    const message = fixtures.createStandardMessage();
    const result = testUtils.formatWithMocks(message);
    
    expect(result).toMatchSnapshot();
  });
});
```

### Regression Prevention

#### Quality Regression Tests

```bash
# Run regression prevention tests
npm test tests/integration/regression-prevention.test.ts

# Validate quality improvements
npm test tests/integration/quality-improvements-validation.test.ts

# End-to-end workflow validation
npm test tests/integration/development-workflow-e2e.test.ts
```

#### Automated Quality Monitoring

```typescript
// Quality metrics are automatically tracked
interface QualityMetrics {
  linting: {
    totalViolations: number;
    criticalViolations: number;
  };
  typeSafety: {
    anyTypeUsage: number;
    typeErrors: number;
  };
  testing: {
    coverage: number;
    failingTests: number;
  };
}

// Metrics are compared against historical data
// Regressions trigger alerts and block deployments
```

### Performance Testing

#### Performance Benchmarks

```bash
# Run performance benchmarks
npm run test:performance

# Profile memory usage
node --inspect scripts/performance-benchmark.ts

# Monitor CI performance
npm run ci:performance
```

#### Performance Standards

- **Build Time**: < 2 minutes
- **Test Execution**: < 5 minutes  
- **Memory Usage**: < 512MB peak
- **Response Time**: < 100ms for API calls

### Quality Reporting

#### Daily Quality Reports

```bash
# Generate comprehensive quality report
npm run quality:report

# View quality metrics dashboard
cat quality-metrics-report.md

# Track quality trends
cat quality-metrics-history.json
```

#### CI Quality Dashboard

Our CI pipeline generates quality dashboards showing:
- Test pass/fail rates
- Code coverage trends
- Linter violation trends
- Performance metrics
- Type safety improvements

### Quality Maintenance

#### Weekly Quality Reviews

1. **Review quality metrics report**
2. **Identify regression trends**
3. **Plan quality improvement tasks**
4. **Update quality standards if needed**

#### Monthly Quality Audits

1. **Comprehensive codebase scan**
2. **Dependency security audit**
3. **Performance benchmark review**
4. **Quality tool updates**

#### Quality Improvement Process

1. **Identify Quality Issues**
   ```bash
   npm run quality-audit
   ```

2. **Generate Improvement Plan**
   ```bash
   npx ts-node scripts/generate-fix-plan.ts
   ```

3. **Apply Automated Fixes**
   ```bash
   npx ts-node scripts/fix-unused-variables.ts
   npx ts-node scripts/type-replacer.ts
   ```

4. **Validate Fixes**
   ```bash
   npm run quality:validate-fixes
   npm run test
   ```

5. **Track Progress**
   ```bash
   npm run quality:track-progress
   ```

## Documentation Standards

### JSDoc Comments

```typescript
/**
 * Retrieves user information by ID.
 * 
 * @param userId - The unique identifier for the user
 * @returns Promise that resolves to user data or error
 * @throws {ValidationError} When userId is invalid
 * 
 * @example
 * ```typescript
 * const result = await userService.getUser('123');
 * if (ErrorHandler.isSuccess(result)) {
 *   console.log(result.data.name);
 * }
 * ```
 */
async getUser(userId: string): Promise<Result<User>> {
  // Implementation
}
```

### README Updates

Keep README.md current with:
- Setup instructions
- Usage examples
- API documentation
- Troubleshooting guide

### Code Comments

```typescript
// Good: Explain why, not what
// Use exponential backoff to handle rate limiting
const delay = Math.pow(2, attempt) * 1000;

// Bad: Explain what the code does
// Multiply attempt by 2 and then by 1000
const delay = Math.pow(2, attempt) * 1000;
```

## Performance Guidelines

### Database Queries

```typescript
// Good: Use specific queries
const users = await repository.findActiveUsers({
  limit: 10,
  fields: ['id', 'name', 'email']
});

// Bad: Fetch all data
const users = await repository.findAll();
const activeUsers = users.filter(u => u.active).slice(0, 10);
```

### Memory Management

```typescript
// Good: Clean up resources
class DataProcessor {
  private cache = new Map();

  async process(data: Data[]): Promise<void> {
    try {
      // Process data
    } finally {
      this.cache.clear(); // Clean up
    }
  }
}

// Bad: Memory leaks
class DataProcessor {
  private cache = new Map();

  async process(data: Data[]): Promise<void> {
    // Process data
    // Cache grows indefinitely
  }
}
```

### Async Operations

```typescript
// Good: Use Promise.all for parallel operations
const [users, settings, stats] = await Promise.all([
  userService.getUsers(),
  settingsService.getSettings(),
  statsService.getStats()
]);

// Bad: Sequential operations
const users = await userService.getUsers();
const settings = await settingsService.getSettings();
const stats = await statsService.getStats();
```

## Security Guidelines

### Input Validation

```typescript
// Good: Validate all inputs
function processUserInput(input: unknown): Result<ProcessedInput> {
  const validation = validateUserInput(input);
  if (!validation.isValid) {
    return failure(new ValidationError('Invalid input', {
      errors: validation.errors
    }));
  }
  
  return success(sanitizeInput(validation.data));
}

// Bad: Trust user input
function processUserInput(input: any): ProcessedInput {
  return input; // Dangerous!
}
```

### HTML Escaping

```typescript
// Good: Always escape user content
const safeMessage = escapeHtml(userMessage);
const html = `<div>${safeMessage}</div>`;

// Bad: Raw user content
const html = `<div>${userMessage}</div>`; // XSS vulnerability
```

### Error Messages

```typescript
// Good: Generic error messages
return failure(new AuthenticationError('Invalid credentials'));

// Bad: Specific error messages
return failure(new AuthenticationError('User not found')); // Information disclosure
```

## Troubleshooting

### Common Issues

#### TypeScript Compilation Errors

```bash
# Clear TypeScript cache
rm -rf node_modules/.cache
npm run type-check
```

#### ESLint Errors

```bash
# Fix auto-fixable issues
npm run lint:fix

# Check specific files
npx eslint src/specific-file.ts --fix
```

#### Test Failures

```bash
# Run specific test
npm test -- --grep "UserService"

# Run tests with verbose output
npm test -- --reporter=verbose

# Clear test cache
npm test -- --clearCache
```

#### Development Server Issues

```bash
# Clear Wrangler cache
rm -rf .wrangler

# Restart development server
npm run dev
```

#### Database Issues

```bash
# Run migrations
npx wrangler d1 migrations apply telegram-history-bot

# Check database status
npx wrangler d1 info telegram-history-bot
```

### Getting Help

1. **Check documentation** in `docs/` directory
2. **Search existing issues** in the repository
3. **Ask in team chat** for quick questions
4. **Create an issue** for bugs or feature requests
5. **Schedule a code review** for complex changes

### Performance Debugging

```bash
# Run performance tests
npm run test:performance

# Profile memory usage
node --inspect-brk scripts/profile-memory.js

# Analyze bundle size
npm run analyze-bundle
```

### Debugging Tips

1. **Use TypeScript strict mode** to catch errors early
2. **Enable source maps** for better debugging
3. **Use console.time()** for performance measurement
4. **Add debug logging** with correlation IDs
5. **Use Result<T> pattern** for better error tracking

## Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Vitest Documentation](https://vitest.dev/)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Prettier Configuration](https://prettier.io/docs/en/configuration.html)

## Contributing

1. Read and follow these guidelines
2. Set up your development environment
3. Create a feature branch
4. Make your changes with tests
5. Run quality checks
6. Submit a pull request
7. Respond to code review feedback

Thank you for contributing to the Telegram History Bot project! 🚀