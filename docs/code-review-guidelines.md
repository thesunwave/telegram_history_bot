# Code Review Guidelines

This document outlines the code review process and standards for the Telegram History Bot project.

## Overview

Code reviews are essential for maintaining code quality, sharing knowledge, and preventing bugs. Every pull request must be reviewed by at least one team member before merging.

## Review Process

### 1. Pre-Review Checklist (Author)

Before requesting a review, ensure your code meets these criteria:

- [ ] **Builds successfully** - No TypeScript compilation errors
- [ ] **Tests pass** - All existing tests continue to pass
- [ ] **New tests added** - New functionality includes appropriate tests
- [ ] **ESLint passes** - No linting errors or warnings
- [ ] **Prettier formatted** - Code is properly formatted
- [ ] **Documentation updated** - JSDoc comments for public APIs
- [ ] **Self-review completed** - You've reviewed your own changes

### 2. Review Request

When creating a pull request:

1. **Clear title** - Summarize the change in 50 characters or less
2. **Detailed description** - Explain what changed and why
3. **Link issues** - Reference related issues or tickets
4. **Screenshots** - Include visual changes if applicable
5. **Testing notes** - Explain how to test the changes

### 3. Review Timeline

- **Initial response**: Within 24 hours
- **Complete review**: Within 48 hours
- **Follow-up reviews**: Within 24 hours

## Review Criteria

### Code Quality

#### ✅ Good Practices
- **Single responsibility** - Functions and classes have one clear purpose
- **Descriptive names** - Variables, functions, and classes have meaningful names
- **Consistent style** - Follows project conventions and ESLint rules
- **Error handling** - Proper error handling with Result<T> pattern
- **Type safety** - Strong typing without `any` unless necessary
- **Documentation** - Public APIs have comprehensive JSDoc comments

#### ❌ Red Flags
- **Complex functions** - Functions longer than 50 lines or with high complexity
- **Magic numbers** - Unexplained numeric constants
- **Commented code** - Dead code that should be removed
- **TODO comments** - Untracked technical debt
- **Console.log** - Debug statements left in production code
- **Hardcoded values** - Configuration that should be externalized

### Architecture & Design

#### ✅ Good Practices
- **Separation of concerns** - Clear boundaries between layers
- **Dependency injection** - Loose coupling between components
- **Interface segregation** - Small, focused interfaces
- **Open/closed principle** - Open for extension, closed for modification
- **DRY principle** - No code duplication

#### ❌ Red Flags
- **Tight coupling** - Direct dependencies between unrelated modules
- **God objects** - Classes that do too many things
- **Circular dependencies** - Modules that depend on each other
- **Leaky abstractions** - Implementation details exposed through interfaces

### Security

#### ✅ Good Practices
- **Input validation** - All user input is validated and sanitized
- **HTML escaping** - User content is properly escaped for display
- **Error messages** - Don't expose sensitive information
- **Secrets management** - No hardcoded secrets or API keys

#### ❌ Red Flags
- **SQL injection** - Dynamic SQL without parameterization
- **XSS vulnerabilities** - Unescaped user content in HTML
- **Information disclosure** - Stack traces or internal details in error messages
- **Insecure dependencies** - Known vulnerable packages

### Performance

#### ✅ Good Practices
- **Efficient algorithms** - Appropriate time and space complexity
- **Resource cleanup** - Proper disposal of resources
- **Caching** - Appropriate use of caching mechanisms
- **Lazy loading** - Load resources only when needed

#### ❌ Red Flags
- **Memory leaks** - Objects not properly disposed
- **N+1 queries** - Inefficient database access patterns
- **Blocking operations** - Synchronous operations that should be async
- **Large payloads** - Unnecessary data transfer

### Testing

#### ✅ Good Practices
- **Test coverage** - New code has appropriate test coverage
- **Test quality** - Tests are readable and maintainable
- **Edge cases** - Tests cover boundary conditions and error scenarios
- **Test isolation** - Tests don't depend on each other

#### ❌ Red Flags
- **Flaky tests** - Tests that pass/fail inconsistently
- **Slow tests** - Tests that take too long to run
- **Brittle tests** - Tests that break with minor changes
- **Missing tests** - Critical functionality without tests

## Review Comments

### Providing Feedback

#### Comment Types
- **Must fix** - Critical issues that block merge
- **Should fix** - Important issues that should be addressed
- **Consider** - Suggestions for improvement
- **Nitpick** - Minor style or preference issues
- **Question** - Requests for clarification

#### Comment Guidelines
- **Be specific** - Point to exact lines and explain the issue
- **Be constructive** - Suggest solutions, not just problems
- **Be respectful** - Focus on the code, not the person
- **Explain why** - Help the author understand the reasoning
- **Provide examples** - Show better alternatives when possible

#### Example Comments

**Good:**
```
Must fix: This function could throw an unhandled exception if `data.violations` is undefined. 
Consider adding a null check or using optional chaining:

```typescript
const count = data.violations?.length ?? 0;
```

**Bad:**
```
This will crash.
```

### Responding to Feedback

#### As an Author
- **Acknowledge feedback** - Respond to all comments
- **Ask for clarification** - If you don't understand the feedback
- **Explain decisions** - If you disagree with a suggestion
- **Make changes promptly** - Address feedback quickly
- **Thank reviewers** - Appreciate the time spent reviewing

#### As a Reviewer
- **Follow up** - Check that your feedback was addressed
- **Approve when ready** - Don't hold up good code for minor issues
- **Escalate if needed** - Involve senior developers for complex issues

## Common Review Scenarios

### New Features
- [ ] Requirements are clearly understood
- [ ] Design follows established patterns
- [ ] Error handling is comprehensive
- [ ] Tests cover happy path and edge cases
- [ ] Documentation is updated
- [ ] Performance impact is considered

### Bug Fixes
- [ ] Root cause is identified and addressed
- [ ] Fix doesn't introduce new issues
- [ ] Test added to prevent regression
- [ ] Related code is reviewed for similar issues

### Refactoring
- [ ] Behavior is preserved
- [ ] Tests still pass
- [ ] Performance is not degraded
- [ ] Dependencies are not broken
- [ ] Documentation is updated

### Performance Improvements
- [ ] Benchmarks show actual improvement
- [ ] Changes don't affect correctness
- [ ] Memory usage is considered
- [ ] Edge cases are tested

## Tools and Automation

### Automated Checks
- **TypeScript compilation** - Must pass without errors
- **ESLint** - Must pass without errors or warnings
- **Prettier** - Code must be properly formatted
- **Tests** - All tests must pass
- **Security scan** - No known vulnerabilities

### Manual Review Focus
Since automated tools handle style and basic issues, manual reviews should focus on:
- **Logic and algorithms**
- **Architecture and design**
- **Business requirements**
- **User experience**
- **Security implications**
- **Performance considerations**

## Review Metrics

Track these metrics to improve the review process:

- **Review turnaround time**
- **Number of review iterations**
- **Defect escape rate**
- **Code coverage trends**
- **Technical debt accumulation**

## Escalation Process

### When to Escalate
- **Disagreement on approach** - Technical decisions that can't be resolved
- **Quality concerns** - Code that doesn't meet standards
- **Timeline issues** - Reviews that are blocking critical work
- **Learning opportunities** - Complex changes that warrant broader discussion

### Escalation Steps
1. **Discussion** - Try to resolve through comments
2. **Video call** - Schedule a quick discussion
3. **Team lead** - Involve technical lead for guidance
4. **Architecture review** - For significant design decisions

## Best Practices Summary

### For Authors
- **Small PRs** - Keep changes focused and reviewable
- **Clear commits** - Use descriptive commit messages
- **Self-review** - Review your own code first
- **Context** - Provide sufficient background information
- **Responsive** - Address feedback promptly

### For Reviewers
- **Timely** - Review within agreed timeframes
- **Thorough** - Check all aspects of the change
- **Constructive** - Provide helpful feedback
- **Consistent** - Apply standards fairly
- **Educational** - Help authors learn and improve

### For Teams
- **Standards** - Maintain consistent review standards
- **Documentation** - Keep guidelines up to date
- **Training** - Help team members improve review skills
- **Metrics** - Track and improve review effectiveness
- **Culture** - Foster a positive review culture

## Resources

- [ESLint Configuration](./.eslintrc.js)
- [Prettier Configuration](./.prettierrc.js)
- [TypeScript Configuration](./tsconfig.json)
- [Testing Guidelines](./testing-guidelines.md)
- [Architecture Documentation](./architecture.md)