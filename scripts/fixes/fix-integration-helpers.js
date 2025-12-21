const fs = require('fs');

const filePath = 'tests/integration/summary-integration-helpers.test.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Remove old spy creation patterns
content = content.replace(
  /const optimizedController = new OptimizedSummaryController\(env\);\s*const summarizeSpy = vi\s*\.spyOn\(optimizedController,\s*"summarizeChat"\)\s*\.mockResolvedValue\([^)]+\);/g,
  ''
);

// Remove other spy creation patterns
content = content.replace(
  /const optimizedController = new OptimizedSummaryController\([^)]+\);\s*const [^;]+ = vi\s*\.spyOn\([^;]+\);/g,
  ''
);

// Replace references to old spies with mockInstance
content = content.replace(/summarizeSpy/g, 'mockInstance.summarizeChat');
content = content.replace(/optimizedController\.summarizeChat/g, 'mockInstance.summarizeChat');
content = content.replace(/optimizedController\.summarizeChatMessages/g, 'mockInstance.summarizeChatMessages');

// Fix specific test patterns
content = content.replace(
  /vi\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChat"\)/g,
  'mockInstance.summarizeChat'
);

content = content.replace(
  /vi\.spyOn\(OptimizedSummaryController\.prototype,\s*"summarizeChatMessages"\)/g,
  'mockInstance.summarizeChatMessages'
);

// Fix constructor spy patterns
content = content.replace(
  /const constructorSpy = vi\.spyOn\(OptimizedSummaryController,\s*'constructor'\)[^;]*;/g,
  ''
);

// Fix environment capture patterns
content = content.replace(
  /let capturedEnv[^;]*;\s*const constructorSpy[^}]+}/g,
  'let capturedEnv: Env | undefined;\n    const MockedController = vi.mocked(OptimizedSummaryController);\n    MockedController.mockImplementation((env) => {\n      capturedEnv = env;\n      return mockInstance;\n    });'
);

fs.writeFileSync(filePath, content);
console.log('Fixed integration helpers tests');