const fs = require('fs');

const filePath = 'tests/integration/summary-integration-helpers.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Remove all vi.mocked(MockController).mockImplementation patterns
content = content.replace(
  /vi\.mocked\(MockController\)\.mockImplementation\([^}]+}\);/g,
  ''
);

// Remove all vi.mocked(loadOptimizationConfig).mockImplementation patterns
content = content.replace(
  /vi\.mocked\(loadOptimizationConfig\)\.mockImplementation\([^}]+}\);/g,
  ''
);

// Remove MockController variable declarations
content = content.replace(
  /const MockController = vi\.mocked\([^)]+\);/g,
  ''
);

// Remove loadOptimizationConfig imports and mocks
content = content.replace(
  /const { loadOptimizationConfig } = await import\([^)]+\);/g,
  ''
);

// Fix tests that create their own mock instances - replace with mockInstance usage
content = content.replace(
  /const mockInstance = \{[^}]+\};/g,
  '// Using global mockInstance from beforeEach'
);

// Fix environment capture test
content = content.replace(
  /let capturedEnv: Env \| undefined;[^}]+return \{[^}]+\};[^}]+\);/g,
  `let capturedEnv: Env | undefined;
      const originalMockImplementation = vi.mocked(OptimizedSummaryController).getMockImplementation();
      vi.mocked(OptimizedSummaryController).mockImplementation((envArg: Env) => {
        capturedEnv = envArg;
        return mockInstance;
      });`
);

// Fix instance counting test
content = content.replace(
  /let instanceCount = 0;[^}]+return \{[^}]+\};[^}]+\);/g,
  `let instanceCount = 0;
      const originalMockImplementation = vi.mocked(OptimizedSummaryController).getMockImplementation();
      vi.mocked(OptimizedSummaryController).mockImplementation(() => {
        instanceCount++;
        return mockInstance;
      });`
);

// Add mock setup for tests that need specific behavior
const testsNeedingSpecificMocks = [
  {
    testName: 'should parse boolean string values correctly',
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock result");'
  },
  {
    testName: 'should handle boolean type values correctly', 
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock result");'
  },
  {
    testName: 'should use default values when environment variable is missing',
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock result");'
  },
  {
    testName: 'should handle summarizeChatMessages with optimized system',
    setup: 'mockInstance.summarizeChatMessages.mockResolvedValue("Mock messages result");'
  },
  {
    testName: 'should fallback for summarizeChatMessages when optimized fails',
    setup: 'mockInstance.summarizeChatMessages.mockRejectedValue(new Error("Mock failure"));'
  },
  {
    testName: 'should correctly pass parameters to optimized system for chat-based requests',
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock chat result");'
  },
  {
    testName: 'should correctly pass parameters to optimized system for message-based requests',
    setup: 'mockInstance.summarizeChatMessages.mockResolvedValue("Mock messages result");'
  },
  {
    testName: 'should handle undefined/null parameter scenarios',
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock result");'
  },
  {
    testName: 'should handle rapid successive calls efficiently',
    setup: 'mockInstance.summarizeChat.mockResolvedValue("Mock result");'
  }
];

testsNeedingSpecificMocks.forEach(({ testName, setup }) => {
  const testPattern = new RegExp(`(it\\("${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^{]*{[^}]*)(const testMessages = createTestMessages\\([^)]+\\);[^}]*vi\\.mocked\\(fetchMessages\\)\\.mockResolvedValue\\(testMessages\\);)`, 'g');
  
  content = content.replace(testPattern, (match, beforeMessages, messagesSetup) => {
    return beforeMessages + messagesSetup + '\n      ' + setup;
  });
});

fs.writeFileSync(filePath, content);
console.log('Fixed all integration helper tests with proper mock usage');