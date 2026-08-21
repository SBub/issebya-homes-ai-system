# Screenshot and Mockup Usage Guidelines

This document defines how to use screenshots and mockups attached to feature issues when writing implementation specifications.

## Purpose of Mockups

Screenshots and mockups attached to issues serve as **visual references only**. They are:

- **Mockups**: Quick visual representations of desired UI
- **NOT prototypes**: They don't represent pixel-perfect designs or exact implementations

## When Writing Implementation Specifications

### 1. Extract Visual Requirements

When mockups are attached to an issue, analyze them for:

| Aspect                  | What to Extract                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| **Layout**              | General positioning of elements (top, bottom, left, right, centered) |
| **Component hierarchy** | Which elements contain others, nesting relationships                 |
| **UI elements**         | Buttons, inputs, labels, headers present in the mockup               |
| **Text content**        | ALL visible text - labels, prices, descriptions, info messages       |
| **Dynamic data**        | Calculations, totals, prices, counts that need to be computed        |
| **States**              | Different UI states shown (collapsed, expanded, loading, error)      |
| **Interactions**        | Modal triggers, form flows, navigation patterns                      |

**CRITICAL**: Every piece of text visible in the mockup must be documented. If the mockup shows:

- Pricing like "65€ / night" → Document that pricing must be displayed
- Calculations like "Total: 500€" → Document that totals must be calculated
- Info text like "Week discount - 8%" → Document the exact text and format

### 2. Reference Mockups in Specifications

When writing specs, explicitly reference the visual elements:

**Good example:**

> Per mockup: The "Create Custom Offer" button should be positioned in the top-left area of the admin page. Clicking it opens a modal dialog with the form fields shown.

**Bad example:**

> Add a button that opens a modal.

### 3. Don't Over-Specify Visual Details

Since mockups are not pixel-perfect designs:

- **DO** specify: element positioning (top-left, centered), general layout, component presence
- **DON'T** specify: exact pixel values, precise colors, font sizes (unless explicitly stated in issue)

### 4. Identify All States

Look for multiple mockups showing different states:

- Initial/empty state
- Form open state
- Loading state
- Success state
- Error state

Document each state you observe in the specification.

### 5. Cross-Reference with Text Description

Mockups should complement the text description in the issue:

1. Read the text requirements first
2. Review mockups to understand visual intent
3. If mockup and text conflict, **text takes precedence**
4. If mockup shows details not in text, include them as implementation notes

## Example Analysis

Given an issue with mockups showing:

1. Empty admin page with "create custom offer" button (top-left)
2. Modal with form fields (Guest name, Start date, End date, Room Type, Price, Number of guests)
3. Success state with checkmark and "verify custom offer" link

**Extract:**

- Admin page layout: minimal, with single primary action button
- Button placement: top-left area
- Modal structure: header + form + submit button
- Form fields: 6 inputs as specified
- Success feedback: checkmark icon + secondary action link

## Content Accuracy Rule

If a text element (headings, labels, buttons, etc.) does NOT appear in the mockup, do NOT add it in the implementation. Only include UI text that is explicitly shown or described in the requirements.

**Example**: Don't add an "Admin Dashboard" heading if the mockup shows only the functional elements without such a heading.

---

## Required Specification Section

When mockups are present, the implementation spec MUST include a "Visual Requirements from Mockup" section. Use this template:

```markdown
## Visual Requirements from Mockup

### State: [State Name] (e.g., "Collapsed", "Expanded", "Loading")

**Layout:**

- [Describe element positioning]

**UI Elements:**

- [ ] [Element 1]: [description]
- [ ] [Element 2]: [description]

**Text Content:**

- [ ] "[Exact text from mockup]" - [where it appears]
- [ ] "[Another text]" - [where it appears]

**Dynamic Data:**

- [ ] [Calculation/data requirement] - [how it's computed]

### State: [Next State Name]

[Repeat for each state shown in mockups]
```

**Example:**

```markdown
## Visual Requirements from Mockup

### State: Collapsed (Default View)

**Layout:**

- Date range selector at top with book button on right
- Pricing info below date selector

**UI Elements:**

- [ ] Date range display: shows check-in and check-out dates
- [ ] Book button: triggers expanded state or booking action

**Text Content:**

- [ ] "65€ / night" - pricing display below dates
- [ ] "Week discount - 8%, month discount - 10%" - discount info

### State: Expanded (Calendar Open)

**UI Elements:**

- [ ] Two-month calendar view side by side
- [ ] Summary row with nights and person count
- [ ] Close and Book buttons

**Text Content:**

- [ ] "X nights" / "Y person(s)" - summary counts
- [ ] "Total: XXX€" - calculated total
- [ ] "Tourist tax: XX€" - tax amount
- [ ] "Info about tourist tax: charged first 3 nights, 2€ per person"

**Dynamic Data:**

- [ ] Total calculation: (nights × price) - discount + tourist tax
- [ ] Tourist tax: 2€ × persons × min(nights, 3)
```

---

## AI Agent Rules

When processing issues with attachments:

1. **Always examine screenshots** if present in the issue
2. **Document visual observations** in the specification using the template above
3. **Extract EVERY visible text element** - don't skip pricing, labels, or info text
4. **Document ALL states** shown in mockups (collapsed, expanded, loading, etc.)
5. **Note mockup limitations** - they show structure/intent, not pixel-perfect design
6. **Use existing app styles** - fonts, buttons, colors should match the app, not the mockup
7. **Ask for clarification** if mockups are unclear or conflict with text
8. **Do not invent UI text** - only include text elements visible in mockups or explicitly requested
