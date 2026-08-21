# Unit Test Spec Format

Use this format when creating unit test specifications for features.

## Template

```markdown
# Unit Testing Spec: <feature name>

## Test Scope

### In Scope

<what business logic, utilities, and functions will be tested from Relevant Files and New Files>

## New Unit Tests

### Test Files to Create

<list NEW unit test files to be created with naming convention: `<module-name>.unit.test.ts`>

### Coverage Areas

<describe what business logic, utilities, and functions need unit testing>

### Test Cases

#### <Module/Function Name>

**Purpose**: <what this module/function does>

**Test Cases**:

- <test case 1: description of what behavior is being validated>
- <test case 2: description of what behavior is being validated>
- <test case 3: edge cases, error conditions, boundary conditions>

## Failed/Broken Tests (if applicable)

**To discover failed/broken unit tests, run**: `yarn test:unit` or `npx vitest --project=unit`

If the feature implementation broke existing unit tests, document them here:

### <Test File Path>

**Test Name**: <name of the failing test>

**Why It Failed**: <explain why this test failed - what changed in the implementation that broke it>

**How to Fix**: <describe the changes needed to fix this test - update assertions, mock different behavior, etc.>

**Test Cases After Fix**:

- <updated test case 1>
- <updated test case 2>

### Validation Command

`yarn test:unit` or `npx vitest --project=unit`

**Note**: All unit tests (new and fixed) must pass before the feature is considered complete.
```

## Guidelines

- Only test business logic, utilities, and pure functions
- Test files use pattern: `src/app/**/*.unit.test.ts`
- Tests run in Node environment (not browser)
- Focus on: input/output behavior, edge cases, error conditions
- Do NOT test: UI components, external libraries, implementation details
- Document ALL tests that fail during implementation, explain why, and how to fix them
