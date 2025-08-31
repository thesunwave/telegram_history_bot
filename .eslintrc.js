/**
 * Enhanced ESLint Configuration for Telegram History Bot
 * Comprehensive rules for code quality, type safety, and maintainability
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
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
    'import',
    'security',
  ],
  rules: {
    // ========================================
    // 🔒 CRITICAL RULES (Must be fixed)
    // ========================================
    
    // TypeScript type safety (critical)
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    
    // Unused variables (critical)
    '@typescript-eslint/no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      destructuredArrayIgnorePattern: '^_'
    }],
    'no-unused-vars': 'off', // Use TypeScript version
    
    // Undefined variables (critical)
    'no-undef': 'error',
    '@typescript-eslint/no-undef': 'off', // TypeScript handles this
    
    // Unreachable code (critical)
    'no-unreachable': 'error',
    'no-constant-condition': 'error',
    
    // Duplicate keys/cases (critical)
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    
    // ========================================
    // 🚨 HIGH PRIORITY RULES
    // ========================================
    
    // TypeScript best practices
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/no-unnecessary-condition': 'error',
    '@typescript-eslint/strict-boolean-expressions': ['error', {
      allowString: false,
      allowNumber: false,
      allowNullableObject: false,
      allowNullableBoolean: false,
      allowNullableString: false,
      allowNullableNumber: false,
      allowAny: false
    }],
    
    // Function and variable declarations
    '@typescript-eslint/prefer-const': 'error',
    '@typescript-eslint/no-var-requires': 'error',
    '@typescript-eslint/no-require-imports': 'error',
    'no-var': 'error',
    'prefer-const': 'off', // Use TypeScript version
    
    // Type definitions
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    '@typescript-eslint/consistent-type-imports': ['error', {
      prefer: 'type-imports',
      disallowTypeAnnotations: false
    }],
    '@typescript-eslint/no-import-type-side-effects': 'error',
    
    // Promise handling
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/require-await': 'error',
    
    // ========================================
    // 🔧 MEDIUM PRIORITY RULES
    // ========================================
    
    // Code style and consistency
    '@typescript-eslint/naming-convention': ['error',
      {
        selector: 'variableLike',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow'
      },
      {
        selector: 'typeLike',
        format: ['PascalCase']
      },
      {
        selector: 'interface',
        format: ['PascalCase'],
        custom: {
          regex: '^I[A-Z]',
          match: false
        }
      }
    ],
    
    // Function complexity
    'complexity': ['warn', { max: 15 }],
    'max-depth': ['warn', { max: 4 }],
    'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
    
    // Import organization
    'import/order': ['error', {
      groups: [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'index'
      ],
      'newlines-between': 'always',
      alphabetize: {
        order: 'asc',
        caseInsensitive: true
      }
    }],
    'import/no-duplicates': 'error',
    'import/no-unused-modules': 'warn',
    
    // Error handling
    '@typescript-eslint/no-throw-literal': 'error',
    '@typescript-eslint/prefer-promise-reject-errors': 'error',
    
    // ========================================
    // 🛡️ SECURITY RULES
    // ========================================
    
    'security/detect-object-injection': 'warn',
    'security/detect-non-literal-regexp': 'warn',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'warn',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'warn',
    'security/detect-non-literal-require': 'warn',
    'security/detect-possible-timing-attacks': 'warn',
    'security/detect-pseudoRandomBytes': 'error',
    
    // ========================================
    // 📝 CODE QUALITY RULES
    // ========================================
    
    // Console and debugging
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-debugger': 'error',
    'no-alert': 'error',
    
    // Dangerous patterns
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    
    // Best practices
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
    'no-empty-pattern': 'error',
    
    // Comments and documentation
    'spaced-comment': ['error', 'always', {
      line: { markers: ['/'] },
      block: { markers: ['*'], balanced: true }
    }],
    
    // ========================================
    // 🎨 FORMATTING RULES (Auto-fixable)
    // ========================================
    
    '@typescript-eslint/semi': ['error', 'always'],
    '@typescript-eslint/comma-dangle': ['error', 'never'],
    '@typescript-eslint/quotes': ['error', 'single', { avoidEscape: true }],
    '@typescript-eslint/indent': ['error', 2, { SwitchCase: 1 }],
    '@typescript-eslint/object-curly-spacing': ['error', 'always'],
    '@typescript-eslint/array-bracket-spacing': ['error', 'never'],
    
    // Spacing
    '@typescript-eslint/space-before-function-paren': ['error', {
      anonymous: 'always',
      named: 'never',
      asyncArrow: 'always'
    }],
    '@typescript-eslint/keyword-spacing': 'error',
    '@typescript-eslint/space-infix-ops': 'error',
    
    // Line breaks
    'eol-last': ['error', 'always'],
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
    'no-trailing-spaces': 'error',
  },
  overrides: [
    {
      // Test files have different rules
      files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
      env: {
        jest: true,
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'no-console': 'off',
      },
    },
    {
      // Mock files have relaxed rules
      files: ['**/mocks/**/*.ts', '**/fixtures/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Configuration files
      files: ['*.config.js', '*.config.ts', '.eslintrc.js'],
      env: {
        node: true,
      },
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
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
  ],

};