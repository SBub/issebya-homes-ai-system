# Component Test Spec Format

Use this format when creating component test specifications for features.

## Test Type Decision Criteria

Choose the appropriate test type based on what you're testing:

### Component Tests (`*.browser.test.tsx`)

- Test a **single component in isolation**
- Mock all child components
- Focus on: props handling, local state, user interactions, rendering logic
- Example: Testing a form component's validation without testing its child input components

### Integration Tests (`*.integration.browser.test.tsx`)

- Test **multiple components working together**
- Use selective mocking (some children real, some mocked)
- Focus on: state flow between components, lifecycle coordination, user journeys
- Example: Testing a modal with form that transitions to success view

**When to write integration tests:**

- Parent manages state shared across children (e.g., form state, success/error state)
- Testing state transitions triggered by child callbacks
- Verifying component orchestration (open modal → fill form → submit → show success)

## Template

```markdown
# Component Testing Spec: <feature name>

## Test Scope

### In Scope

<what synchronous client components will be tested from Relevant Files and New Files>

## New Component Tests

### Test Files to Create

<list NEW component test files to be created with naming convention: `<component-name>.browser.test.tsx`>

**Note**: Only synchronous client components. Async Server Components should use E2E tests.

### Coverage Areas

<describe what UI components need component testing>

### Test Cases

#### <Component Name>

**Purpose**: <what this component does>

**User Interactions to Test**:

- <interaction 1: e.g., clicking button triggers action>
- <interaction 2: e.g., form submission validates and submits>
- <interaction 3: e.g., error states display correctly>

**Accessibility to Test**:

- <accessibility requirement 1: e.g., keyboard navigation works>
- <accessibility requirement 2: e.g., screen reader labels are correct>

**Edge Cases**:

- <edge case 1>
- <edge case 2>

### Mocking Strategy

<describe what external dependencies need to be mocked and how (use vi.fn() for functions, vi.mock() for modules)>

## Integration Tests (if applicable)

### Test Files to Create

<list integration test files: `<ParentComponent>.integration.browser.test.tsx`>

### Integration Pattern

Choose one:

- **Pattern A (Partial Mock)**: Mock complex children, keep structural components real
  - Use when: Testing parent's state management and orchestration logic
- **Pattern B (Full Integration)**: All children real, only mock external APIs
  - Use when: Testing end-to-end user flows through component hierarchy

### Components Under Integration

- **Real (not mocked)**: <components tested together>
- **Mocked**: <components mocked for isolation>

### State Flows to Test

- <flow 1: e.g., button click opens modal with form>
- <flow 2: e.g., form submission transitions to success view>
- <flow 3: e.g., modal close resets state>

### Selective Mocking Strategy

<describe which children to mock and why>
<for Pattern A: describe callback capture approach, e.g., `capturedOnSuccess = onSuccess`>
<include minimal mock implementations with data-testid for verification>

## Failed/Broken Tests (if applicable)

**To discover failed/broken component tests, run**: `yarn test:browser` or `npx vitest --project=browser --browser.headless`

If the feature implementation broke existing component tests, document them here:

### <Test File Path>

**Test Name**: <name of the failing test>

**Why It Failed**: <explain why this test failed - component props changed, behavior changed, UI structure changed, etc.>

**How to Fix**: <describe the changes needed to fix this test - update selectors, change assertions, mock different data, etc.>

**Test Cases After Fix**:

- <updated test case 1>
- <updated test case 2>

### Validation Command

`yarn test:browser` or `npx vitest --project=browser --browser.headless`

**Note**: All component tests (new and fixed) must pass before the feature is considered complete.
```

## Guidelines

### General

- Only test synchronous client components (use 'use client' directive)
- Tests run in real browsers (Chromium, Firefox, WebKit) with Playwright
- Focus on: user interactions, accessibility, conditional rendering, edge cases
- Do NOT test: async Server Components (use E2E), external libraries, CSS classes
- Document ALL tests that fail during implementation, explain why, and how to fix them

### File Naming Patterns

- Component tests: `src/app/**/*.browser.test.tsx` or `src/ui/**/*.browser.test.tsx`
- Integration tests: `src/app/**/*.integration.browser.test.tsx` or `src/ui/**/*.integration.browser.test.tsx`

### Integration Test Patterns

- **Pattern A (Partial Mock)**: Mock complex children (forms, views) with minimal implementations that expose callbacks via `data-testid` buttons. Keep structural components (modals, layouts) real.
- **Pattern B (Full Integration)**: Keep all children real. Only mock external dependencies (fetch, APIs). Best for testing complete user journeys.
