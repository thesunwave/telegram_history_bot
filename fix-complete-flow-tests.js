const fs = require('fs');

const filePath = 'tests/integration/summary-complete-flow.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace all instances of vi.spyOn(OptimizedSummaryController.prototype, "summarizeChat") with optimizedChatSpy
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChat"\)/g,
  'const optimizedSpy = optimizedChatSpy'
);

// Replace all instances of vi.spyOn(OptimizedSummaryController.prototype, "summarizeChatMessages") with optimizedMessagesSpy
content = content.replace(
  /const optimizedSpy = vi\s*\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChatMessages"\)/g,
  'const optimizedSpy = optimizedMessagesSpy'
);

// Replace any remaining spyOn calls for summarizeChat
content = content.replace(
  /vi\s*\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChat"\)/g,
  'optimizedChatSpy'
);

// Replace any remaining spyOn calls for summarizeChatMessages
content = content.replace(
  /vi\s*\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChatMessages"\)/g,
  'optimizedMessagesSpy'
);

// Fix AI.run spy creation issues
content = content.replace(
  /const aiRunSpy = vi\.spyOn\(invalidEnv\.AI,\s*'run'\)/g,
  'invalidEnv.AI.run = vi.fn()'
);

// Fix any remaining AI.run references that need to be spies
content = content.replace(
  /vi\.spyOn\(([^.]+)\.AI,\s*'run'\)/g,
  '$1.AI.run = vi.fn()'
);

fs.writeFileSync(filePath, content);
console.log('Fixed all spy issues in summary-complete-flow.test.ts');