# Chore: Co-locate UI Components with Pages

## Metadata

issue_number: `42`
adw_id: `8745a915`
issue_json: `{"number":42,"title":"Update app/ folder structure","body":"Currently, my files and folder structure in the app directory includes pages separately from the components that used on those pages, and the components located in the ui/ folder. I want the ui folder to be co-located in pages, so I can easily find components. But if they are shared across different pages, I want them to stay in /ui folder within /app folder"}`

## Chore Description

This chore reorganizes the project's component structure by moving page-specific UI components from the centralized `src/ui/` folder to be co-located with their respective pages in the `src/app/` directory. Components that are shared across multiple pages will remain in `src/app/ui/` for easy reuse. This improves developer experience by making it immediately clear which components belong to which pages and reducing the need to navigate between distant folders.

## User Story

As a developer
I want UI components co-located with the pages that use them
So that I can quickly find and modify components without searching through a centralized ui folder

## Problem Statement

The current structure separates all UI components into a single `src/ui/` folder, making it difficult to understand component ownership and relationships. When working on a specific page, developers must navigate to a separate directory to find the components used by that page. This creates unnecessary cognitive overhead and slows down development.

## Solution Statement

Move page-specific components from `src/ui/` to be co-located in `ui/` subdirectories within their respective page folders in `src/app/`. Shared components used across multiple pages (Header, Footer, WhatsAppLink) will remain in a global `src/app/ui/` folder for easy reuse. All import paths will be updated to use the `@/app/` prefix for app-specific components.

## Relevant Files

Use these files to resolve the chore:

**Current Global UI Components (src/ui/):**

- `src/ui/AdminHeader.tsx` - Admin page header, only used by admin page
- `src/ui/AdminPageClient.tsx` - Admin page client component, only used by admin page
- `src/ui/BookingContent.tsx` - Booking content display, only used by booking pages
- `src/ui/BookingInfoBlock.tsx` - Booking info block, used by BookingContent
- `src/ui/BookingTabsDesktop.tsx` - Desktop tabs for booking pages, only used by booking pages
- `src/ui/BookingTabsMobile.tsx` - Mobile tabs for booking pages, only used by booking pages
- `src/ui/Callout.tsx` - Callout component, used by BookingContent
- `src/ui/CreateOfferForm.tsx` - Create offer form, only used by admin
- `src/ui/CreateOfferModal.tsx` - Create offer modal, only used by admin
- `src/ui/CreateOfferSuccess.tsx` - Success message for offer creation, only used by admin
- `src/ui/CustomBookingDetails.tsx` - Custom booking details display, only used by custom booking page
- `src/ui/EndDateInput.tsx` - End date input, only used by CreateOfferForm
- `src/ui/Gallery.tsx` - Image gallery, only used by booking pages
- `src/ui/GuestsInput.tsx` - Guests input, only used by CreateOfferForm
- `src/ui/InfoSection.tsx` - Info section, used by BookingContent
- `src/ui/TabButton.tsx` - Tab button, used by BookingTabs components
- `src/ui/AirbnbButton.tsx` - Airbnb button, used by BookingContent
- `src/ui/Copyright.tsx` - Copyright text, used by Footer

**Shared Components (stay in src/app/ui/):**

- `src/ui/Header.tsx` - Used by main layout (3 pages)
- `src/ui/Footer.tsx` - Used by main layout (1 location but affects all main pages)
- `src/ui/WhatsAppLink.tsx` - Used by contact, guest-info, and custom booking not-found pages (3 pages)

**Pages that import components:**

- `src/app/admin/page.tsx` - Imports AdminPageClient
- `src/app/admin/layout.tsx` - Imports AdminHeader
- `src/app/(main)/layout.tsx` - Imports Header, Footer (shared)
- `src/app/(main)/booking/[type]/page.tsx` - Imports Gallery, BookingContent, BookingTabsMobile, BookingTabsDesktop
- `src/app/(main)/contact/page.tsx` - Imports WhatsAppLink (shared)
- `src/app/(main)/guest-info/page.tsx` - Imports WhatsAppLink (shared)
- `src/app/(main)/custom_booking/[token]/page.tsx` - Imports CustomBookingDetails
- `src/app/(main)/custom_booking/[token]/not-found.tsx` - Imports WhatsAppLink (shared)

**Configuration:**

- `tsconfig.json` - Contains path alias configuration for `@/*` mapping to `./src/*`

### New Files

After reorganization, the structure will be:

**Shared components in src/app/ui/:**

- `src/app/ui/Header.tsx` (moved from src/ui/)
- `src/app/ui/Footer.tsx` (moved from src/ui/)
- `src/app/ui/WhatsAppLink.tsx` (moved from src/ui/)
- `src/app/ui/Copyright.tsx` (moved from src/ui/, used by Footer)

**Admin page components:**

- `src/app/admin/ui/AdminHeader.tsx` (moved from src/ui/)
- `src/app/admin/ui/AdminPageClient.tsx` (moved from src/ui/)
- `src/app/admin/ui/CreateOfferModal.tsx` (moved from src/ui/)
- `src/app/admin/ui/CreateOfferForm.tsx` (moved from src/ui/)
- `src/app/admin/ui/CreateOfferSuccess.tsx` (moved from src/ui/)
- `src/app/admin/ui/EndDateInput.tsx` (moved from src/ui/, used by CreateOfferForm)
- `src/app/admin/ui/GuestsInput.tsx` (moved from src/ui/, used by CreateOfferForm)

**Booking page components:**

- `src/app/(main)/booking/ui/BookingContent.tsx` (moved from src/ui/)
- `src/app/(main)/booking/ui/BookingTabsDesktop.tsx` (moved from src/ui/)
- `src/app/(main)/booking/ui/BookingTabsMobile.tsx` (moved from src/ui/)
- `src/app/(main)/booking/ui/Gallery.tsx` (moved from src/ui/)
- `src/app/(main)/booking/ui/BookingInfoBlock.tsx` (moved from src/ui/, used by BookingContent)
- `src/app/(main)/booking/ui/Callout.tsx` (moved from src/ui/, used by BookingContent)
- `src/app/(main)/booking/ui/InfoSection.tsx` (moved from src/ui/, used by BookingContent)
- `src/app/(main)/booking/ui/TabButton.tsx` (moved from src/ui/, used by BookingTabs)
- `src/app/(main)/booking/ui/AirbnbButton.tsx` (moved from src/ui/, used by BookingContent)

**Custom booking page components:**

- `src/app/(main)/custom_booking/ui/CustomBookingDetails.tsx` (moved from src/ui/)

## Implementation Plan

### Phase 1: Foundation

Create the new `ui/` directories within each page section:

- Create `src/app/ui/` for shared components
- Create `src/app/admin/ui/` for admin-specific components
- Create `src/app/(main)/booking/ui/` for booking page components
- Create `src/app/(main)/custom_booking/ui/` for custom booking page components

### Phase 2: Core Implementation

Move components from `src/ui/` to their new locations:

1. **Move shared components** to `src/app/ui/`:
   - Header.tsx
   - Footer.tsx
   - WhatsAppLink.tsx
   - Copyright.tsx (dependency of Footer)

2. **Move admin components** to `src/app/admin/ui/`:
   - AdminHeader.tsx
   - AdminPageClient.tsx
   - CreateOfferModal.tsx
   - CreateOfferForm.tsx
   - CreateOfferSuccess.tsx
   - EndDateInput.tsx (dependency of CreateOfferForm)
   - GuestsInput.tsx (dependency of CreateOfferForm)

3. **Move booking components** to `src/app/(main)/booking/ui/`:
   - BookingContent.tsx
   - BookingTabsDesktop.tsx
   - BookingTabsMobile.tsx
   - Gallery.tsx
   - BookingInfoBlock.tsx (dependency of BookingContent)
   - Callout.tsx (dependency of BookingContent)
   - InfoSection.tsx (dependency of BookingContent)
   - TabButton.tsx (dependency of BookingTabs)
   - AirbnbButton.tsx (dependency of BookingContent)

4. **Move custom booking components** to `src/app/(main)/custom_booking/ui/`:
   - CustomBookingDetails.tsx

### Phase 3: Integration

Update all import statements in pages and components:

1. Update imports in `src/app/admin/page.tsx` to use `@/app/admin/ui/AdminPageClient`
2. Update imports in `src/app/admin/layout.tsx` to use `@/app/admin/ui/AdminHeader`
3. Update imports in `src/app/(main)/layout.tsx` to use `@/app/ui/Header` and `@/app/ui/Footer`
4. Update imports in `src/app/(main)/booking/[type]/page.tsx` to use `@/app/(main)/booking/ui/*`
5. Update imports in `src/app/(main)/contact/page.tsx` to use `@/app/ui/WhatsAppLink`
6. Update imports in `src/app/(main)/guest-info/page.tsx` to use `@/app/ui/WhatsAppLink`
7. Update imports in `src/app/(main)/custom_booking/[token]/page.tsx` to use `@/app/(main)/custom_booking/ui/CustomBookingDetails`
8. Update imports in `src/app/(main)/custom_booking/[token]/not-found.tsx` to use `@/app/ui/WhatsAppLink`
9. Update internal imports within moved components (e.g., CreateOfferForm importing EndDateInput)
10. Update Footer.tsx to import Copyright from `@/app/ui/Copyright`
11. Update BookingContent to import its dependencies from the same directory

Clean up:

- Remove the now-empty `src/ui/` directory

## Technical Considerations

### Performance

No performance impact expected. This is a purely structural change that does not affect runtime behavior or bundle size.

### Security

No security implications. Component logic and security measures remain unchanged.

### Accessibility

No accessibility changes. Components maintain their existing accessibility features.

### Error Handling

No changes to error handling. This chore only moves files and updates import paths.

## Prerequisites (BLOCKING)

Complete ALL prerequisites before running /implement. These require human action and cannot be automated.

### Infrastructure Tasks

None required for this chore.

### Environment Tasks

Existing environment variables are sufficient for this chore.

---

NOTE: The /implement command will verify these prerequisites before starting code implementation. If any prerequisite fails verification, implementation will be BLOCKED until the human completes the required action.

## Step by Step Tasks

IMPORTANT: Prerequisites section above MUST be completed first. These steps assume all infrastructure and environment is ready.

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create new ui directories

- Create `src/app/ui/` directory for shared components
- Create `src/app/admin/ui/` directory for admin components
- Create `src/app/(main)/booking/ui/` directory for booking components
- Create `src/app/(main)/custom_booking/ui/` directory for custom booking components

### 2. Move shared components to src/app/ui/

- Move `src/ui/Header.tsx` to `src/app/ui/Header.tsx`
- Move `src/ui/Footer.tsx` to `src/app/ui/Footer.tsx`
- Move `src/ui/WhatsAppLink.tsx` to `src/app/ui/WhatsAppLink.tsx`
- Move `src/ui/Copyright.tsx` to `src/app/ui/Copyright.tsx`
- Update `src/app/ui/Footer.tsx` import to use `@/app/ui/Copyright`

### 3. Move admin components to src/app/admin/ui/

- Move `src/ui/AdminHeader.tsx` to `src/app/admin/ui/AdminHeader.tsx`
- Move `src/ui/AdminPageClient.tsx` to `src/app/admin/ui/AdminPageClient.tsx`
- Move `src/ui/CreateOfferModal.tsx` to `src/app/admin/ui/CreateOfferModal.tsx`
- Move `src/ui/CreateOfferForm.tsx` to `src/app/admin/ui/CreateOfferForm.tsx`
- Move `src/ui/CreateOfferSuccess.tsx` to `src/app/admin/ui/CreateOfferSuccess.tsx`
- Move `src/ui/EndDateInput.tsx` to `src/app/admin/ui/EndDateInput.tsx`
- Move `src/ui/GuestsInput.tsx` to `src/app/admin/ui/GuestsInput.tsx`
- Update `src/app/admin/ui/CreateOfferModal.tsx` imports to use `@/app/admin/ui/CreateOfferForm` and `@/app/admin/ui/CreateOfferSuccess`
- Update `src/app/admin/ui/CreateOfferForm.tsx` imports to use `@/app/admin/ui/EndDateInput` and `@/app/admin/ui/GuestsInput`
- Update `src/app/admin/ui/AdminPageClient.tsx` import to use `@/app/admin/ui/CreateOfferModal`

### 4. Move booking components to src/app/(main)/booking/ui/

- Move `src/ui/BookingContent.tsx` to `src/app/(main)/booking/ui/BookingContent.tsx`
- Move `src/ui/BookingTabsDesktop.tsx` to `src/app/(main)/booking/ui/BookingTabsDesktop.tsx`
- Move `src/ui/BookingTabsMobile.tsx` to `src/app/(main)/booking/ui/BookingTabsMobile.tsx`
- Move `src/ui/Gallery.tsx` to `src/app/(main)/booking/ui/Gallery.tsx`
- Move `src/ui/BookingInfoBlock.tsx` to `src/app/(main)/booking/ui/BookingInfoBlock.tsx`
- Move `src/ui/Callout.tsx` to `src/app/(main)/booking/ui/Callout.tsx`
- Move `src/ui/InfoSection.tsx` to `src/app/(main)/booking/ui/InfoSection.tsx`
- Move `src/ui/TabButton.tsx` to `src/app/(main)/booking/ui/TabButton.tsx`
- Move `src/ui/AirbnbButton.tsx` to `src/app/(main)/booking/ui/AirbnbButton.tsx`
- Update `src/app/(main)/booking/ui/BookingContent.tsx` imports to use `@/app/(main)/booking/ui/BookingInfoBlock`, `@/app/(main)/booking/ui/Callout`, `@/app/(main)/booking/ui/InfoSection`, and `@/app/(main)/booking/ui/AirbnbButton`
- Update `src/app/(main)/booking/ui/BookingTabsDesktop.tsx` import to use `@/app/(main)/booking/ui/TabButton`
- Update `src/app/(main)/booking/ui/BookingTabsMobile.tsx` import to use `@/app/(main)/booking/ui/TabButton`

### 5. Move custom booking components to src/app/(main)/custom_booking/ui/

- Move `src/ui/CustomBookingDetails.tsx` to `src/app/(main)/custom_booking/ui/CustomBookingDetails.tsx`

### 6. Update page imports

- Update `src/app/admin/page.tsx` to import AdminPageClient from `@/app/admin/ui/AdminPageClient`
- Update `src/app/admin/layout.tsx` to import AdminHeader from `@/app/admin/ui/AdminHeader`
- Update `src/app/(main)/layout.tsx` to import Header from `@/app/ui/Header` and Footer from `@/app/ui/Footer`
- Update `src/app/(main)/booking/[type]/page.tsx` to import Gallery, BookingContent, BookingTabsMobile, BookingTabsDesktop from `@/app/(main)/booking/ui/*`
- Update `src/app/(main)/contact/page.tsx` to import WhatsAppLink from `@/app/ui/WhatsAppLink`
- Update `src/app/(main)/guest-info/page.tsx` to import WhatsAppLink from `@/app/ui/WhatsAppLink`
- Update `src/app/(main)/custom_booking/[token]/page.tsx` to import CustomBookingDetails from `@/app/(main)/custom_booking/ui/CustomBookingDetails`
- Update `src/app/(main)/custom_booking/[token]/not-found.tsx` to import WhatsAppLink from `@/app/ui/WhatsAppLink`

### 7. Clean up old src/ui directory

- Verify all components have been moved (src/ui/ should be empty)
- Delete the `src/ui/` directory

### 8. Run validation commands

- Execute all validation commands to ensure zero regressions

## Testing Strategy

### Edge Cases

- Verify all import paths are correct and resolve properly
- Ensure no broken imports or missing files
- Confirm TypeScript compilation succeeds with no errors
- Verify the application runs correctly in development mode
- Ensure the build process completes successfully

## Acceptance Criteria

- All page-specific components are co-located with their pages in `ui/` subdirectories
- Shared components (Header, Footer, WhatsAppLink, Copyright) are in `src/app/ui/`
- All import paths use the `@/app/` prefix correctly
- No broken imports or missing files
- TypeScript compilation succeeds with zero errors
- Application builds successfully without warnings
- Application runs correctly in development mode
- Original `src/ui/` directory is removed

## Validation Commands

Execute every command to validate the chore is complete with zero regressions.

- `yarn build` - Run frontend build to validate the chore works with zero regressions

## Notes

### Import Path Pattern

After this reorganization:

- Shared components: `@/app/ui/ComponentName`
- Admin components: `@/app/admin/ui/ComponentName`
- Booking components: `@/app/(main)/booking/ui/ComponentName`
- Custom booking components: `@/app/(main)/custom_booking/ui/ComponentName`

### Component Relationships

**Admin page component tree:**

```
AdminPageClient
├── CreateOfferModal
    ├── CreateOfferForm
    │   ├── EndDateInput
    │   └── GuestsInput
    └── CreateOfferSuccess
```

**Booking page component tree:**

```
BookingContent
├── BookingInfoBlock
├── Callout
├── InfoSection
└── AirbnbButton

BookingTabsDesktop
└── TabButton

BookingTabsMobile
└── TabButton
```

### Future Considerations

This structure makes it easy to:

- Find components related to specific pages
- Identify which components are shared vs. page-specific
- Move components between shared and page-specific as usage patterns change
- Add new page-specific components without cluttering a global ui folder
