# E2E Test: Plausible Analytics Integration

Test analytics tracking functionality across the issebya.homes website.

## User Story

As a business owner
I want to verify that all analytics events are properly tracked
So that I can measure user engagement and conversion intent

## Test Steps

1. Navigate to the `Application URL` (http://localhost:3000)
2. Take a screenshot of the initial state
3. **Verify** Plausible script is loaded in the page head
4. Navigate to the Weekly Offer page for Room 1
5. Take a screenshot of the Weekly Offer page
6. **Verify** room tabs are visible
7. Click on the Room 2 tab
8. **Verify** the page updates to show Room 2 details
9. Scroll down to 50% of the page
10. **Verify** gallery thumbnails are visible
11. Click on a gallery thumbnail
12. **Verify** WhatsApp and Airbnb links are present
13. Take a screenshot of the Weekly Offer page with all interactive elements
14. Navigate to the Booking page (Room 1)
15. Take a screenshot of the Booking page
16. **Verify** gallery is present
17. Click on a gallery thumbnail
18. **Verify** WhatsApp link is present
19. Navigate to the Contact page
20. Take a screenshot of the Contact page
21. **Verify** WhatsApp link is present
22. **Verify** Instagram link is present (if applicable)

## Success Criteria

- Plausible script loads successfully on all pages
- All interactive elements (tabs, links, gallery) are present
- Scroll tracking component doesn't interfere with page functionality
- All tracked links maintain original behavior (open in new tab, correct URLs)
- Navigation between pages works smoothly
- 4 screenshots are taken
- No JavaScript errors in console related to analytics

## Analytics Events Expected (Manual Verification)

These events should appear in the Plausible dashboard (manual verification required):

**Weekly Offer Page:**

- WeeklyOfferViewed (automatic pageview)
- RoomTabClicked (when switching between rooms)
- GalleryThumbnailClicked (when clicking gallery images)
- WhatsAppClicked (with page: "Weekly Offer")
- AirbnbClicked (when clicking Airbnb link)
- Scrolled50% (when scrolling halfway down)

**Booking Page:**

- BookingViewed (automatic pageview)
- GalleryThumbnailClicked (when clicking gallery images)
- WhatsAppClicked (with page: "Booking")

**Contact Page:**

- ContactViewed (automatic pageview)
- WhatsAppClicked (with page: "Contact")
- InstagramClicked (if Instagram link exists)
