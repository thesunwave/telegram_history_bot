/**
 * Critical ESLint Rules Configuration
 * Only the most critical rules that must pass before commit
 * Used by pre-commit hooks to enforce essential code quality
 */

module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    worker: true,
  },
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
    'security',
  ],
  rules: {
    // ========================================
    // 🔒 CRITICAL RULES - MUST BE FIXED
    // ========================================
    
    // Type safety violations that can cause runtime errors
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    
    // Unused variables (can indicate dead code or bugs)
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_'
    }],
    'no-unused-vars': 'off',
    
    // Undefined variables (will cause runtime errors)
    'no-undef': 'error',
    
    // Unreachable code (indicates logic errors)
    'no-unreachable': 'error',
    'no-constant-condition': 'error',
    
    // Duplicate keys/cases (logic errors)
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    
    // Promise handling (can cause unhandled rejections)
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    
    // Dangerous patterns
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    
    // Security vulnerabilities
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-pseudoRandomBytes': 'error',
    
    // Function signature issues
    '@typescript-eslint/no-non-null-assertion': 'error',
    
    // Import/export issues
    '@typescript-eslint/no-var-requires': 'error',
    
    // Variable declaration issues
    'no-var': 'error',
    '@typescript-eslint/prefer-const': 'error',
    
    // Empty patterns that might indicate incomplete code
    'no-empty-pattern': 'error',
  },
  overrides: [
    {
      // Test files have slightly relaxed critical rules
      files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
      env: {
        jest: true,
        vitest: true,
      },
      rules: {
        // Allow any in test files for mocking
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        
        // Allow non-null assertions in tests
        '@typescript-eslint/no-non-null-assertion': 'off',
        
        // Allow floating promises in tests (for fire-and-forget test operations)
        '@typescript-eslint/no-floating-promises': 'off',
      },
    },
    {
      // Mock and fixture files have very relaxed rules
      files: ['**/mocks/**/*.ts', '**/fixtures/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // Configuration files
      files: ['*.config.js', '*.config.ts', '.eslintrc.js', '.eslintrc.critical.js'],
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        'no-undef': 'off', // Config files might use global variables
      },
    },
    {
      // Script files may have different patterns
      files: ['scripts/**/*.ts', 'scripts/**/*.js'],
      rules: {
        // Scripts might use console for output
        'no-console': 'off',
        // Scripts might use process.exit
        'no-process-exit': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '.wrangler/',
    '*.d.ts',
    'coverage/',
    '.backup/',
    'reports/',
  ],
};