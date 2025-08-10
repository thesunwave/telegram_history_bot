const fs = require('fs');

const filePath = 'tests/integration/summary-integration-helpers.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Add mock setup for all tests that need it
const testsNeedingMocks = [
  'should fallback to legacy when optimized system fails',
  'should handle OptimizedSummaryController method failures', 
  'should bypass optimized system when disabled',
  'should handle summarizeChatMessages with optimized system',
  'should fallback for summarizeChatMessages when optimized fails',
  'should correctly pass parameters to optimized system for chat-based requests',
  'should correctly pass parameters to optimized system for message-based requests',
  'should handle configuration loading failures gracefully',
  'should handle mixed success/failure scenarios',
  'should handle undefined/null parameter scenarios',
  'should handle rapid successive calls efficiently'
];

// Add mock setup before each test that needs it
testsNeedingMocks.forEach(testName => {
  const testPattern = new RegExp(`(it\\("${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^{]*{[^}]*)(const testMessages = createTestMessages\\([^)]+\\);[^}]*vi\\.mocked\\(fetchMessages\\)\\.mockResolvedValue\\(testMessages\\);)`, 'g');
  
  content = content.replace(testPattern, (match, beforeMessages, messagesSetup) => {
    if (testName.includes('summarizeChatMessages')) {
      return beforeMessages + messagesSetup + '\n      mockInstance.summarizeChatMessages.mockResolvedValue("Mock messages summary");';
    } else if (testName.includes('should fallback') || testName.includes('should handle OptimizedSummaryController method failures')) {
      return beforeMessages + messagesSetup + '\n      mockInstance.summarizeChat.mockRejectedValue(new Error("Mock failure"));';
    } else {
      return beforeMessages + messagesSetup + '\n      mockInstance.summarizeChat.mockResolvedValue("Mock summary result");';
    }
  });
});

// Fix specific patterns for tests that don't follow the standard pattern
content = content.replace(
  /(it\("should bypass optimized system when disabled"[^{]*{[^}]*)(const testMessages[^}]*mockResolvedValue\(testMessages\);)/g,
  '$1$2\n      // No need to mock optimized methods since they should not be called'
);

// Fix the mixed success/failure test
content = content.replace(
  /(it\("should handle mixed success\/failure scenarios"[^{]*{[^}]*)(const env = createMockEnv[^}]*);/g,
  '$1$2;\n      mockInstance.summarizeChat.mockResolvedValueOnce("First success").mockRejectedValueOnce(new Error("Second failure"));'
);

// Fix undefined/null parameter test
content = content.replace(
  /(it\("should handle undefined\/null parameter scenarios"[^{]*{[^}]*)(const env = createMockEnv[^}]*);/g,
  '$1$2;\n      mockInstance.summarizeChat.mockResolvedValue("Mock result for null params");'
);

// Fix rapid successive calls test
content = content.replace(
  /(it\("should handle rapid successive calls efficiently"[^{]*{[^}]*)(const env = createMockEnv[^}]*);/g,
  '$1$2;\n      mockInstance.summarizeChat.mockResolvedValue("Mock rapid call result");'
);

fs.writeFileSync(filePath, content);
console.log('Fixed all integration helper tests with proper mocks');