/**
 * Prettier Configuration for Telegram History Bot
 * 
 * This configuration ensures consistent code formatting across the project
 * with settings optimized for TypeScript development and readability.
 */

module.exports = {
  // Basic formatting
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  tabWidth: 2,
  useTabs: false,
  
  // Line length and wrapping
  printWidth: 100,
  proseWrap: 'preserve',
  
  // Bracket spacing
  bracketSpacing: true,
  bracketSameLine: false,
  
  // Arrow functions
  arrowParens: 'avoid',
  
  // End of line
  endOfLine: 'lf',
  
  // Embedded language formatting
  embeddedLanguageFormatting: 'auto',
  
  // HTML whitespace sensitivity
  htmlWhitespaceSensitivity: 'css',
  
  // Insert pragma
  insertPragma: false,
  requirePragma: false,
  
  // Vue files
  vueIndentScriptAndStyle: false,
  
  // Override for specific file types
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 80,
        tabWidth: 2,
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
        tabWidth: 2,
      },
    },
    {
      files: '*.yml',
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: '*.yaml',
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: '*.html',
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: '*.css',
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
    {
      files: '*.scss',
      options: {
        printWidth: 120,
        tabWidth: 2,
      },
    },
  ],
};