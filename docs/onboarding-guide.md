# New Developer Onboarding Guide

Welcome to the Telegram History Bot team! This guide will help you get up to speed quickly and become a productive contributor.

## Table of Contents

- [Welcome & Overview](#welcome--overview)
- [Day 1: Environment Setup](#day-1-environment-setup)
- [Day 2-3: Codebase Exploration](#day-2-3-codebase-exploration)
- [Week 1: First Contributions](#week-1-first-contributions)
- [Week 2-4: Advanced Topics](#week-2-4-advanced-topics)
- [Resources & References](#resources--references)
- [Getting Help](#getting-help)

## Welcome & Overview

### Project Mission

The Telegram History Bot analyzes messages in Telegram chats to detect potential violations of the Russian Criminal Code, providing real-time analysis and statistics to help maintain legal compliance in online communications.

### Key Technologies

- **Runtime**: Cloudflare Workers (Edge Computing)
- **Language**: TypeScript (Strict Mode)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare KV
- **AI Providers**: OpenAI GPT, Cloudflare AI
- **Testing**: Vitest with comprehensive test database infrastructure
- **Code Quality**: ESLint (Critical/Security rules), Prettier, Husky pre-commit hooks
- **Quality Assurance**: Automated type safety auditing, linter violation tracking, performance monitoring

### Team Structure

- **Tech Lead**: Architecture decisions and code reviews
- **Senior Developers**: Feature development and mentoring
- **Developers**: Feature implementation and testing
- **DevOps**: Deployment and infrastructure

### Communication Channels

- **Daily Standups**: 9:00 AM (your timezone)
- **Team Chat**: [Platform/Channel]
- **Code Reviews**: GitHub Pull Requests
- **Documentation**: This repository's `docs/` folder

## Day 1: Environment Setup

### Prerequisites Checklist

- [ ] **Computer Setup**
  - Modern laptop/desktop (8GB+ RAM recommended)
  - Stable internet connection
  - Admin access for software installation

- [ ] **Accounts & Access**
  - GitHub account with repository access
  - Cloudflare account (will be provided)
  - Team communication platform access
  - Calendar access for meetings

### Software Installation

#### 1. Development Tools

```bash
# Install Node.js (use Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20

# Verify installation
node --version  # Should be v20.x.x
npm --version   # Should be 10.x.x

# Install Git (if not already installed)
# macOS: git --version (comes with Xcode tools)
# Windows: Download from https://git-scm.com/
# Linux: sudo apt-get install git

# Install VS Code (recommended)
# Download from https://code.visualstudio.com/
```

#### 2. Repository Setup

```bash
# Clone the repository
git clone [repository-url]
cd telegram-history-bot

# Install dependencies
npm install

# Set up Git hooks
npx husky install

# Copy environment template
cp .env.example .env
```

#### 3. VS Code Extensions

Install these essential extensions:

```bash
# Install via VS Code Extensions panel or command line
code --install-extension ms-vscode.vscode-typescript-next
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
code --install-extension eamodio.gitlens
code --install-extension rangav.vscode-thunder-client
```

#### 4. Environment Configuration

Edit `.env` file with provided values:
```bash
# Your mentor will provide these values
TELEGRAM_BOT_TOKEN=your_bot_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
OPENAI_API_KEY=your_openai_key
# ... other variables
```

#### 5. Verification

```bash
# Run the verification script
npm run verify-system

# Run comprehensive quality checks
npm run quality-check
npm run quality-audit

# Expected output:
# ✅ Node.js version: v20.x.x
# ✅ TypeScript compilation: OK
# ✅ Critical ESLint rules: OK
# ✅ Type safety audit: OK (< 10 'any' types)
# ✅ Prettier formatting: OK
# ✅ Tests: OK
# ✅ Test database: OK
# ✅ Environment variables: OK
# ✅ Quality gates: PASSED
```

### First Day Tasks

- [ ] Complete environment setup
- [ ] Run `npm run quality-check` successfully
- [ ] Run `npm run quality-audit` and understand the output
- [ ] Set up test database with `bash scripts/ci-database-setup.sh`
- [ ] Join team communication channels
- [ ] Schedule 1:1 with your mentor
- [ ] Read this entire onboarding guide
- [ ] Review [Developer Guidelines](./developer-guidelines.md)
- [ ] Review [Code Quality Checklist](./code-quality-checklist.md)
- [ ] Understand our quality standards and tools

## Day 2-3: Codebase Exploration

### Architecture Overview

```
Telegram Bot Request Flow:
1. Telegram → Cloudflare Worker (index.ts)
2. Worker → ViolationHandler (violation-handler.ts)
3. ViolationHandler → AI Providers (providers/)
4. AI Analysis → MessageFormatter (message-formatter.ts)
5. Data Storage → Repositories (repositories/)
6. Response → Telegram
```

### Key Components Deep Dive

#### 1. Entry Point (`src/index.ts`)
```typescript
// Main Cloudflare Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handles all incoming requests
  }
}
```

**Your task**: Read through `src/index.ts` and understand the request flow.

#### 2. Violation Handler (`src/violation-handler.ts`)
```typescript
// Core business logic
export class ViolationHandler {
  async formatViolationMessage(analysis: ViolationAnalysis): Promise<string> {
    // Processes AI analysis and formats messages
  }
}
```

**Your task**: Trace through a violation analysis workflow.

#### 3. AI Providers (`src/providers/`)
```typescript
// Pluggable AI provider system
export interface AIProvider {
  analyzeText(text: string): Promise<ViolationAnalysis>;
}
```

**Your task**: Understand how different AI providers are integrated.

#### 4. Data Layer (`src/repositories/`)
```typescript
// Database operations with Result<T> pattern
export class ViolationRepository {
  async save(violation: Violation): Promise<Result<void>> {
    // Database operations with proper error handling
  }
}
```

**Your task**: Learn the Result<T> error handling pattern.

### Exploration Exercises

#### Exercise 1: Follow a Request (30 minutes)
1. Set a breakpoint in `src/index.ts`
2. Send a test message to the bot
3. Step through the code execution
4. Document the flow in your notes

#### Exercise 2: Understand Error Handling (45 minutes)
1. Find examples of `Result<T>` usage
2. Trace how errors propagate through the system
3. Look at error logging and monitoring
4. Try to trigger an error and see how it's handled

#### Exercise 3: Database Schema (30 minutes)
1. Review `migrations/` folder
2. Understand the database schema
3. Look at how data flows from API to database
4. Run a local query to see sample data

#### Exercise 4: Testing Patterns (45 minutes)
1. Read test files in `tests/` directory
2. Understand mocking patterns
3. Run tests and see coverage report
4. Write a simple test for practice

### Daily Learning Goals

**Day 2**:
- [ ] Understand overall architecture
- [ ] Complete Exercise 1 (Request Flow)
- [ ] Complete Exercise 2 (Error Handling)
- [ ] Read [Code Quality Checklist](./code-quality-checklist.md)

**Day 3**:
- [ ] Complete Exercise 3 (Database Schema)
- [ ] Complete Exercise 4 (Testing Patterns)
- [ ] Review recent pull requests
- [ ] Set up local development workflow
- [ ] Complete Quality Standards Deep Dive (see below)

### Quality Standards Deep Dive (Day 3)

Understanding our quality standards is crucial for success on this team.

#### Exercise 5: Quality Tools Exploration (60 minutes)

1. **Linter Configuration Deep Dive**
   ```bash
   # Understand different linter configurations
   cat .eslintrc.js              # Standard rules
   cat .eslintrc.critical.js     # Build-breaking rules
   cat .eslintrc.security.js     # Security-focused rules
   
   # Run different linter checks
   npm run lint                  # Full linting
   npx eslint src --config .eslintrc.critical.js  # Critical only
   npx eslint src --config .eslintrc.security.js  # Security only
   ```

2. **Type Safety Audit**
   ```bash
   # Run type safety audit
   npm run quality:type-audit
   
   # Review the report
   cat type-safety-audit-report-summary.md
   
   # Understand 'any' type usage
   grep -r ": any" src/
   grep -r "as any" src/
   ```

3. **Test Database Infrastructure**
   ```bash
   # Set up test database
   bash scripts/ci-database-setup.sh
   
   # Run database tests
   DATABASE_URL="file:./test.db" npm run test:database
   
   # Explore test utilities
   ls tests/utils/test-*
   cat tests/utils/test-database-manager.ts
   ```

4. **Quality Metrics**
   ```bash
   # Generate quality report
   npm run quality:report
   
   # Review metrics
   cat quality-metrics-report.md
   
   # Understand quality tracking
   npm run quality:track-progress
   ```

#### Exercise 6: Pre-commit Hook Testing (30 minutes)

1. **Create a test commit with quality issues**
   ```bash
   # Create a file with intentional issues
   echo "var unusedVariable = 'test';" > test-quality.js
   git add test-quality.js
   git commit -m "test: quality check"
   # Should be blocked by pre-commit hooks
   ```

2. **Fix the issues and commit successfully**
   ```bash
   # Fix the issue
   echo "// Test file for quality check" > test-quality.js
   git add test-quality.js
   git commit -m "test: quality check fixed"
   # Should succeed
   
   # Clean up
   git reset --hard HEAD~1
   rm test-quality.js
   ```

#### Exercise 7: Quality Workflow Practice (45 minutes)

1. **Simulate the full quality workflow**
   ```bash
   # Start with quality audit
   npm run quality-audit
   
   # Run comprehensive checks
   npm run quality-check
   
   # Run tests with coverage
   npm run test:coverage
   
   # Generate performance metrics
   npm run ci:performance
   
   # Create quality report
   npm run quality:report
   ```

2. **Understand quality gates**
   - Review `.github/workflows/code-quality.yml`
   - Understand what causes CI to fail
   - Learn about quality metrics tracking

#### Quality Standards Checklist

After completing the exercises, you should understand:

- [ ] **Linting Standards**
  - What constitutes a critical vs warning violation
  - How to fix common linting issues
  - When and how to use automated fixes

- [ ] **Type Safety Requirements**
  - Why we avoid 'any' types
  - How to write proper TypeScript interfaces
  - Runtime type validation patterns

- [ ] **Testing Infrastructure**
  - How test database isolation works
  - MessageFormatter test reliability patterns
  - Integration vs unit test strategies

- [ ] **Quality Metrics**
  - How quality is measured and tracked
  - What quality gates exist in CI
  - How to interpret quality reports

- [ ] **Development Workflow**
  - Pre-commit hook behavior
  - Quality checks in CI/CD pipeline
  - Code review quality standards

## Week 1: First Contributions

### Learning Objectives

By the end of week 1, you should be able to:
- Navigate the codebase confidently
- Understand the development workflow
- Make small bug fixes or improvements
- Write and run tests
- Follow code review process

### Starter Tasks

#### Task 1: Documentation Fix (Day 4)
**Difficulty**: Easy
**Time**: 1-2 hours

Find and fix a documentation issue:
1. Look for outdated information in `docs/`
2. Check for broken links or examples
3. Update JSDoc comments that are missing
4. Submit your first pull request

**Learning goals**: Git workflow, documentation standards

#### Task 2: Add Unit Test (Day 5)
**Difficulty**: Easy-Medium
**Time**: 2-3 hours

Add test coverage for an untested function:
1. Run `npm run test:coverage` to see coverage report
2. Find a function with low/no test coverage
3. Write comprehensive unit tests
4. Ensure tests follow existing patterns

**Learning goals**: Testing patterns, code coverage

#### Task 3: Small Bug Fix (Day 6-7)
**Difficulty**: Medium
**Time**: 4-6 hours

Pick up a "good first issue" from the backlog:
1. Understand the problem thoroughly
2. Write a failing test that reproduces the issue
3. Implement the fix
4. Ensure all tests pass
5. Submit pull request with clear description

**Learning goals**: Debugging, problem-solving, full development cycle

### Code Review Process

#### Submitting Your First PR

1. **Create feature branch**
   ```bash
   git checkout -b fix/documentation-typos
   ```

2. **Make your changes**
   ```bash
   # Edit files
   git add .
   git commit -m "docs: fix typos in developer guidelines"
   ```

3. **Run quality checks**
   ```bash
   npm run quality-check
   ```

4. **Push and create PR**
   ```bash
   git push origin fix/documentation-typos
   # Create PR on GitHub
   ```

#### PR Template Checklist

- [ ] Clear title and description
- [ ] All tests pass
- [ ] Code follows style guidelines
- [ ] Documentation updated if needed
- [ ] Self-review completed

#### Responding to Feedback

- **Be responsive**: Reply within 24 hours
- **Ask questions**: If feedback is unclear
- **Make changes promptly**: Address all comments
- **Learn from feedback**: Take notes for future PRs

### Week 1 Milestones

- [ ] Environment fully set up and working
- [ ] Completed all exploration exercises
- [ ] Submitted first pull request
- [ ] Participated in code review process
- [ ] Attended team meetings and standups
- [ ] 1:1 meeting with mentor completed

## Week 2-4: Advanced Topics

### Week 2: Deep Dive into Core Features

#### Advanced Architecture Patterns

1. **Dependency Injection System**
   ```typescript
   // Learn how services are wired together
   const container = new DIContainer(env);
   container.register('UserService', UserService);
   const userService = container.resolve<UserService>('UserService');
   ```

2. **Result<T> Error Handling**
   ```typescript
   // Master the error handling pattern
   const result = await userService.getUser(id);
   if (ErrorHandler.isFailure(result)) {
     return failure(result.error);
   }
   const user = result.data;
   ```

3. **Provider Pattern**
   ```typescript
   // Understand pluggable AI providers
   const provider = ProviderFactory.createProvider(env);
   const analysis = await provider.analyzeText(message);
   ```

#### Tasks for Week 2

- [ ] **Refactor a service** to use dependency injection
- [ ] **Add a new AI provider** (mock implementation)
- [ ] **Implement caching** for expensive operations
- [ ] **Add monitoring** to track performance metrics

### Week 3: Performance and Scalability

#### Performance Optimization

1. **Database Query Optimization**
   ```typescript
   // Learn efficient query patterns
   const violations = await db.prepare(`
     SELECT v.*, u.name 
     FROM violations v 
     JOIN users u ON v.user_id = u.id 
     WHERE v.chat_id = ? AND v.created_at > ?
   `).bind(chatId, startDate).all();
   ```

2. **Caching Strategies**
   ```typescript
   // Implement smart caching
   const cacheKey = `user_stats:${userId}:${chatId}`;
   const cached = await cache.get(cacheKey);
   if (cached) return cached;
   
   const stats = await calculateUserStats(userId, chatId);
   await cache.set(cacheKey, stats, { ttl: 300 });
   return stats;
   ```

3. **Memory Management**
   ```typescript
   // Prevent memory leaks
   class DataProcessor {
     private cleanup(): void {
       this.cache.clear();
       this.timers.forEach(clearTimeout);
     }
   }
   ```

#### Tasks for Week 3

- [ ] **Profile memory usage** and identify leaks
- [ ] **Optimize slow database queries**
- [ ] **Implement request batching** for AI providers
- [ ] **Add performance monitoring** and alerting

### Week 4: Advanced Features and Integration

#### Complex Feature Development

1. **Multi-step Workflows**
   ```typescript
   // Build complex business logic
   class ViolationAnalysisWorkflow {
     async execute(message: Message): Promise<Result<AnalysisResult>> {
       const validation = await this.validateInput(message);
       if (ErrorHandler.isFailure(validation)) return validation;
       
       const analysis = await this.analyzeWithAI(message);
       if (ErrorHandler.isFailure(analysis)) return analysis;
       
       const storage = await this.storeResults(analysis.data);
       if (ErrorHandler.isFailure(storage)) return storage;
       
       return success(analysis.data);
     }
   }
   ```

2. **Integration Testing**
   ```typescript
   // Test complete workflows
   describe('Violation Analysis E2E', () => {
     it('should process message end-to-end', async () => {
       const message = createTestMessage();
       const result = await violationHandler.processMessage(message);
       
       expect(result.success).toBe(true);
       expect(result.data.violations).toHaveLength(1);
       
       // Verify database state
       const stored = await repository.findByMessageId(message.id);
       expect(stored).toBeDefined();
     });
   });
   ```

#### Tasks for Week 4

- [ ] **Build a complex feature** from requirements to deployment
- [ ] **Write comprehensive integration tests**
- [ ] **Set up monitoring and alerting**
- [ ] **Document your feature** thoroughly

### Monthly Goals

By the end of your first month:

- [ ] **Technical Competency**
  - Can work independently on medium-complexity features
  - Understands all major architectural patterns
  - Writes high-quality, well-tested code
  - Follows all team standards and practices

- [ ] **Team Integration**
  - Actively participates in code reviews
  - Contributes to technical discussions
  - Helps other team members when possible
  - Understands team dynamics and processes

- [ ] **Product Knowledge**
  - Understands business requirements
  - Can make informed technical decisions
  - Knows when to ask for help vs. figure it out
  - Contributes to product planning discussions

## Resources & References

### Essential Reading

1. **Project Documentation**
   - [Developer Guidelines](./developer-guidelines.md)
   - [Code Quality Checklist](./code-quality-checklist.md)
   - [Code Review Guidelines](./code-review-guidelines.md)
   - [Troubleshooting Guide](./troubleshooting-guide.md)

2. **External Resources**
   - [TypeScript Handbook](https://www.typescriptlang.org/docs/)
   - [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
   - [Vitest Documentation](https://vitest.dev/)
   - [Result Pattern in TypeScript](https://dev.to/superluminar-io/the-result-pattern-in-typescript-1jn)

### Learning Path

#### Beginner Level
- [ ] TypeScript fundamentals
- [ ] Cloudflare Workers basics
- [ ] Testing with Vitest
- [ ] Git workflow and PR process

#### Intermediate Level
- [ ] Advanced TypeScript patterns
- [ ] Database design and optimization
- [ ] Error handling patterns
- [ ] Performance optimization

#### Advanced Level
- [ ] System architecture design
- [ ] Scalability patterns
- [ ] Monitoring and observability
- [ ] Security best practices

### Tools and Extensions

#### VS Code Extensions
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "eamodio.gitlens",
    "rangav.vscode-thunder-client",
    "ms-vscode.vscode-json",
    "bradlc.vscode-tailwindcss"
  ]
}
```

#### Useful Commands
```bash
# Development
npm run dev              # Start development server
npm run test:watch       # Run tests in watch mode
npm run quality-check    # Run all quality checks

# Debugging
wrangler tail           # View live logs
npm run health-check    # Check system health
npm run verify-system   # Verify setup

# Database
wrangler d1 execute telegram-history-bot --command="SELECT * FROM violations LIMIT 5"
wrangler d1 migrations list telegram-history-bot
```

## Getting Help

### When to Ask for Help

**Ask immediately for**:
- Security concerns
- Production issues
- Blocked on environment setup
- Unclear requirements

**Try for 30 minutes, then ask**:
- Debugging complex issues
- Understanding unfamiliar code patterns
- Test failures you can't resolve

**Try for 2 hours, then ask**:
- Feature implementation challenges
- Architecture decisions
- Performance optimization

### How to Ask for Help

#### Good Help Request
```
**Problem**: TypeScript compilation fails with "Cannot find module" error

**What I tried**:
1. Cleared node_modules and reinstalled
2. Checked tsconfig.json paths
3. Verified file exists at expected location

**Error message**:
```
error TS2307: Cannot find module '../services/user-service'
```

**Context**: Working on user authentication feature, this started after rebasing

**Files involved**: src/controllers/auth-controller.ts, src/services/user-service.ts
```

#### Bad Help Request
```
"My code doesn't work, can someone help?"
```

### Support Channels

1. **Immediate Help** (< 1 hour response)
   - Team chat for urgent issues
   - Pair programming sessions
   - Screen sharing for complex problems

2. **Daily Help** (< 24 hour response)
   - GitHub issues for bugs
   - Pull request comments
   - Code review feedback

3. **Weekly Help** (scheduled)
   - 1:1 meetings with mentor
   - Team retrospectives
   - Architecture discussions

### Mentorship Program

#### Your Mentor Will Help With
- Code reviews and feedback
- Career development guidance
- Technical decision making
- Team integration

#### You Should Prepare For 1:1s
- Questions about code or architecture
- Challenges you're facing
- Goals for the coming week
- Feedback on team processes

#### Sample 1:1 Agenda
```
1. **This Week's Progress** (5 min)
   - What did you accomplish?
   - What challenges did you face?

2. **Code Review** (10 min)
   - Review recent PRs together
   - Discuss feedback and improvements

3. **Learning & Development** (10 min)
   - What do you want to learn next?
   - Any knowledge gaps to address?

4. **Team & Process** (5 min)
   - How are team interactions going?
   - Any process improvements needed?

5. **Next Week's Goals** (5 min)
   - What will you focus on?
   - Any support needed?
```

## Welcome to the Team! 🚀

Remember, everyone was new once. Don't hesitate to ask questions, make mistakes, and learn from them. We're here to support your growth and success!

Your journey from new team member to productive contributor typically follows this timeline:
- **Week 1**: Getting comfortable with tools and codebase
- **Month 1**: Making meaningful contributions
- **Month 3**: Working independently on complex features
- **Month 6**: Mentoring other new team members

We're excited to have you on the team and look forward to seeing what you'll build! 🎉