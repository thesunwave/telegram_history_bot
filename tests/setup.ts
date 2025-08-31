// Test setup file to mock console API for Cloudflare Workers environment
import { vi } from 'vitest';

// Mock console API for tests since it might not be available in Workers environment
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  groupCollapsed: vi.fn(),
  time: vi.fn(),
  timeEnd: vi.fn(),
  timeLog: vi.fn(),
  count: vi.fn(),
  countReset: vi.fn(),
  clear: vi.fn(),
  table: vi.fn(),
  dir: vi.fn(),
  dirxml: vi.fn(),
  assert: vi.fn(),
};

// Set up global console mock
global.console = mockConsole as any;

// Also ensure it's available on globalThis
globalThis.console = mockConsole as any;

// Mock other globals that might be missing in test environment
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
    getRandomValues: (array: any) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  } as any;
}

// Mock fetch if not available
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = vi.fn();
}

// Mock performance if not available
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = {
    now: () => Date.now(),
    mark: vi.fn(),
    measure: vi.fn(),
    getEntriesByName: vi.fn(() => []),
    getEntriesByType: vi.fn(() => []),
    clearMarks: vi.fn(),
    clearMeasures: vi.fn(),
  } as any;
}