# Linting Guidelines

This document provides comprehensive guidelines for maintaining code quality through ESLint rules and best practices.

## Overview

Our project uses a multi-tiered ESLint configuration to ensure code quality:

- **Critical Rules** (`.eslintrc.critical.js`): Must pass before commit
- **Full Rules** (`.eslintrc.js`): Complete set of quality rules
- **Security Rules** (`.eslintrc.security.js`): Security-focused rules

## Rule Categories

### 🔒 Critical Rules (Must Fix)

These rules prevent runtime errors and maintain type safety:

#### Type Safety
- `@typescript-eslint/no-explicit-any`: Prevents use of `any` type
- `@typescript-eslint/no-unsafe-*`: Prevents unsafe type operations
- `@typescript-eslint/no-non-null-assertion`: Prevents `!` operator

**Example:**
```typescript
// ❌ Bad
function process(data: any) {
  return data.someProperty;
}

// ✅ Good
interface ProcessData {
  someProperty: string;
}

function process(data: ProcessData) {
  return data.someProperty;
}
```

#### Unused Variables
- `@typescript-eslint/no-unused-vars`: Prevents unused variables

**Example:**
```typescript
// ❌ Bad
function calculate(a: number, b: number, unused: string) {
  return a + b;
}

// ✅ Good
function calculate(a: number, b: number, _unused: string) {
  return a + b;
}
```

#### Promise Handling
- `@typescript-eslint/no-floating-promises`: Ensures promises are handled
- `@typescript-eslint/no-misused-promises`: Prevents promise misuse

**Example:**
```typescript
// ❌ Bad
async function saveData() {
  database.save(data); // Floating promise
}

// ✅ Good
async function saveData() {
  await database.save(data);
}
```

### 🚨 High Priority Rules

#### Naming Conventions
- `@typescript-eslint/naming-convention`: Enforces consistent naming

**Examples:**
```typescript
// ✅ Variables: camelCase
const userName = 'john';
const API_KEY = 'secret';

// ✅ Types: PascalCase
interface UserData {
  name: string;
}

// ✅ Classes: PascalCase
class UserManager {
  // ...
}
```

#### Import Organization
- `import/order`: Organizes imports by type
- `import/no-duplicates`: Prevents duplicate imports

**Example:**
```typescript
// ✅ Good import order
import { readFileSync } from 'fs';           // Node.js built-in
import express from 'express';              // External package
import { UserService } from '../services';  // Internal module
import type { User } from './types';        // Type imports
```

### 🔧 Medium Priority Rules

#### Code Complexity
- `complexity`: Limits cyclomatic complexity
- `max-depth`: Limits nesting depth
- `max-lines-per-function`: Limits function length

**Example:**
```typescript
// ❌ Bad - too complex
function processUser(user: User) {
  if (user.isActive) {
    if (user.hasPermission) {
      if (user.isVerified) {
        if (user.subscription) {
          if (user.subscription.isValid) {
            // deeply nested logic
          }
        }
      }
    }
  }
}

// ✅ Good - simplified
function processUser(user: User) {
  if (!user.isActive) return;
  if (!user.hasPermission) return;
  if (!user.isVerified) return;
  if (!user.subscription?.isValid) return;
  
  // process user
}
```

## Configuration Files

### `.eslintrc.js` - Main Configuration
Complete ESLint configuration with all rules for development.

### `.eslintrc.critical.js` - Critical Rules Only
Used by pre-commit hooks and CI for essential checks.

### `.eslintrc.security.js` - Security Rules
Focused on security vulnerabilities and best practices.

## Pre-commit Hooks

Our pre-commit hook runs in two phases:

1. **Critical Phase**: Must pass for commit to proceed
   - TypeScript compilation
   - Critical ESLint rules
   - Security audit

2. **Warning Phase**: Shows warnings but doesn't block
   - Full ESLint check
   - Code formatting
   - Import organization
   - Complexity analysis

## CI/CD Integration

### GitHub Actions Workflow

1. **Critical ESLint Check**: Fails build if critical rules violated
2. **Full ESLint Check**: Reports all issues but doesn't fail
3. **Security Scan**: Checks for vulnerabilities
4. **Quality Gate**: Determines if changes can be merged

## Common Violations and Fixes

### 1. Unused Variables

**Problem:**
```typescript
function calculate(a: number, b: number, c: number) {
  return a + b; // 'c' is unused
}
```

**Solutions:**
```typescript
// Option 1: Remove unused parameter
function calculate(a: number, b: number) {
  return a + b;
}

// Option 2: Prefix with underscore
function calculate(a: number, b: number, _c: number) {
  return a + b;
}

// Option 3: Use parameter
function calculate(a: number, b: number, c: number) {
  return a + b + c;
}
```

### 2. Any Type Usage

**Problem:**
```typescript
function processData(data: any) {
  return data.result;
}
```

**Solutions:**
```typescript
// Option 1: Define interface
interface ApiResponse {
  result: string;
}

function processData(data: ApiResponse) {
  return data.result;
}

// Option 2: Use generics
function processData<T extends { result: string }>(data: T) {
  return data.result;
}

// Option 3: Use unknown with type guards
function processData(data: unknown) {
  if (isApiResponse(data)) {
    return data.result;
  }
  throw new Error('Invalid data');
}
```

### 3. Floating Promises

**Problem:**
```typescript
async function saveUser(user: User) {
  database.save(user); // Promise not awaited
  sendEmail(user.email); // Promise not awaited
}
```

**Solutions:**
```typescript
// Option 1: Await all promises
async function saveUser(user: User) {
  await database.save(user);
  await sendEmail(user.email);
}

// Option 2: Handle promises appropriately
async function saveUser(user: User) {
  await database.save(user);
  
  // Fire-and-forget (explicitly)
  sendEmail(user.email).catch(error => {
    console.error('Failed to send email:', error);
  });
}

// Option 3: Use Promise.all for parallel execution
async function saveUser(user: User) {
  await Promise.all([
    database.save(user),
    sendEmail(user.email)
  ]);
}
```

## Auto-fixing

Many rules can be automatically fixed:

```bash
# Fix auto-fixable issues
npm run lint:fix

# Fix specific files
npx eslint src/file.ts --fix

# Fix only critical issues
npx eslint src/ --config .eslintrc.critical.js --fix
```

## IDE Integration

### VS Code

Install the ESLint extension and add to `settings.json`:

```json
{
  "eslint.validate": ["typescript", "javascript"],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.workingDirectories": ["."]
}
```

### WebStorm/IntelliJ

1. Go to Settings → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
2. Enable "Automatic ESLint configuration"
3. Enable "Run eslint --fix on save"

## Bypassing Rules

### Temporary Disabling

```typescript
// Disable for next line
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = response;

// Disable for block
/* eslint-disable @typescript-eslint/no-explicit-any */
const data: any = response;
const result: any = process(data);
/* eslint-enable @typescript-eslint/no-explicit-any */

// Disable for entire file
/* eslint-disable @typescript-eslint/no-explicit-any */
```

### Bypassing Pre-commit

```bash
# Not recommended - bypasses all checks
git commit --no-verify

# Better - fix the issues or get team approval
```

## Rule Customization

### Adding New Rules

1. Update `.eslintrc.js` with new rule
2. Test on codebase: `npm run lint`
3. Update documentation
4. Consider adding to critical rules if essential

### Disabling Rules

1. Document reason for disabling
2. Get team approval
3. Update configuration
4. Update documentation

## Troubleshooting

### Common Issues

1. **"Parsing error"**: Check TypeScript configuration
2. **"Rule not found"**: Install missing ESLint plugin
3. **"Cannot read config file"**: Check file paths and syntax
4. **Performance issues**: Use `.eslintignore` for large files

### Getting Help

1. Check this documentation
2. Review ESLint official docs
3. Ask team members
4. Create issue in project repository

## Best Practices

1. **Fix critical rules immediately** - they prevent runtime errors
2. **Address warnings gradually** - improve code quality over time
3. **Use auto-fix when possible** - saves time and ensures consistency
4. **Understand the rules** - don't just disable them
5. **Keep configuration updated** - review and update rules regularly
6. **Document exceptions** - explain why rules are disabled
7. **Test rule changes** - ensure they work with existing code

## Resources

- [ESLint Official Documentation](https://eslint.org/docs/)
- [TypeScript ESLint Rules](https://typescript-eslint.io/rules/)
- [ESLint Security Plugin](https://github.com/nodesecurity/eslint-plugin-security)
- [Import Plugin Rules](https://github.com/import-js/eslint-plugin-import)

---

*This document is maintained by the development team. Please keep it updated as rules change.*