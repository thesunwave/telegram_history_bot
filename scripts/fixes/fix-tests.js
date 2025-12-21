#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const filePath = 'tests/integration/summary-complete-flow.test.ts';

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Replace all instances of local optimizedSpy creation for summarizeChat
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChat"\)\s*\.mockResolvedValue\(([\s\S]*?)\);/g,
  (match, mockValue) => {
    return `// Configure the spy for this test\n      optimizedChatSpy.mockResolvedValue(${mockValue});`;
  }
);

// Replace all instances of local optimizedSpy creation for summarizeChatMessages
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChatMessages"\)\s*\.mockResolvedValue\(([\s\S]*?)\);/g,
  (match, mockValue) => {
    return `// Configure the spy for this test\n      optimizedMessagesSpy.mockResolvedValue(${mockValue});`;
  }
);

// Replace all instances of local optimizedSpy creation for mockRejectedValue
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChat"\)\s*\.mockRejectedValue\(([\s\S]*?)\);/g,
  (match, mockValue) => {
    return `// Configure the spy for this test\n      optimizedChatSpy.mockRejectedValue(${mockValue});`;
  }
);

// Replace all instances of local optimizedSpy creation for mockImplementation
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChat"\)\s*\.mockImplementation\(([\s\S]*?)\);/g,
  (match, mockValue) => {
    return `// Configure the spy for this test\n      optimizedChatSpy.mockImplementation(${mockValue});`;
  }
);

// Replace all instances of local optimizedSpy creation for mockResolvedValueOnce
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChat"\)\s*\.mockResolvedValueOnce\(([\s\S]*?)\)\s*\.mockResolvedValueOnce\(([\s\S]*?)\);/g,
  (match, value1, value2) => {
    return `// Configure the spy for this test\n      optimizedChatSpy.mockResolvedValueOnce(${value1})\n        .mockResolvedValueOnce(${value2});`;
  }
);

// Replace all instances of local optimizedSpy creation for mockRejectedValueOnce followed by mockResolvedValueOnce
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype, "summarizeChat"\)\s*\.mockRejectedValueOnce\(([\s\S]*?)\)\s*\.mockResolvedValueOnce\(([\s\S]*?)\);/g,
  (match, value1, value2) => {
    return `// Configure the spy for this test\n      optimizedChatSpy.mockRejectedValueOnce(${value1})\n        .mockResolvedValueOnce(${value2});`;
  }
);

// Replace all expect(optimizedSpy) with expect(optimizedChatSpy) for summarizeChat
content = content.replace(/expect\(optimizedSpy\)\.toHaveBeenCalledWith\((\d+), (\d+)\);/g, 'expect(optimizedChatSpy).toHaveBeenCalledWith($1, $2);');
content = content.replace(/expect\(optimizedSpy\)\.toHaveBeenCalledTimes\((\d+)\);/g, 'expect(optimizedChatSpy).toHaveBeenCalledTimes($1);');
content = content.replace(/expect\(optimizedSpy\)\.toHaveBeenCalled\(\);/g, 'expect(optimizedChatSpy).toHaveBeenCalled();');
content = content.replace(/expect\(optimizedSpy\)\.toHaveBeenNthCalledWith\(/g, 'expect(optimizedChatSpy).toHaveBeenNthCalledWith(');

// For summarizeChatMessages tests, we need to be more specific
content = content.replace(/await summariseChatMessages\(mockEnv, \d+, \d+\);\s*\n\s*expect\(optimizedSpy\)\.toHaveBeenCalledWith\((\d+), (\d+)\);/g, 
  (match, p1, p2) => {
    return match.replace('expect(optimizedSpy)', 'expect(optimizedMessagesSpy)');
  }
);

// Write the file back
fs.writeFileSync(filePath, content, 'utf8');

console.log('Fixed all test spies in', filePath);