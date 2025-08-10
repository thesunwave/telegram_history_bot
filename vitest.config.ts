import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000, // Increased timeout to handle complex tests
    hookTimeout: 10000, // Increased timeout for setup/teardown
    teardownTimeout: 5000, // Increased teardown timeout
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to avoid race conditions
        isolate: true, // Isolate modules between test files to prevent mock leakage
        useAtomics: true,
      },
    },
    globals: true,
    bail: 0, // Run all tests to see full picture
    retry: 1, // Allow one retry for flaky tests
    reporters: ["default"],
    logHeapUsage: false, // Disable heap logging for speed
    allowOnly: false,
    passWithNoTests: true,
    watch: false, // Always disable watch mode
    coverage: {
      enabled: false, // Disable coverage for speed
    },
    // Disable excessive console output during tests
    silent: false,
    outputFile: undefined,
    // Performance optimizations
    maxConcurrency: 1, // Run one test at a time
    // Environment setup
    setupFiles: [],
    globalSetup: [],
    env: {
      NODE_ENV: "test", // Set NODE_ENV to test to disable performance logging
    },
    // Disable file watching and other features that might cause hanging
    disableConsoleIntercept: true,
    // Speed up test discovery
    include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
  },
  esbuild: {
    target: "node18", // Match Cloudflare Workers runtime
  },
});
