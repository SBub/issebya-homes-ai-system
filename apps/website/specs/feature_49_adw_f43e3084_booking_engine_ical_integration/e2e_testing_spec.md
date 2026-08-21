# E2E Test: Booking Engine with iCal Integration

Test the complete booking engine functionality with real iCal data integration.

## User Story

As a potential guest
I want to select my check-in and check-out dates directly on the website and see real-time availability
So that I can quickly book a room without being redirected to external platforms and know which dates are actually available

## Test Steps

### Part 1: Initial State and Loading

1. Navigate to the `Application URL` (http://localhost:3000)
2. Click on the booking button/link for "Room 1" to go to `/booking/room1`
3. Take a screenshot of the initial loading state
4. **Verify** the booking engine component is present
5. **Verify** a loading indicator is shown while fetching availability
6. Wait for the booking engine to load (max 10 seconds)

### Part 2: Collapsed State with Default Dates

7. **Verify** the booking engine is in collapsed state after loading
8. **Verify** check-in date is displayed with formatted text (e.g., "Feb 18, 2026")
9. **Verify** check-out date is displayed with formatted text
10. **Verify** the dates are the first 2 consecutive available nights
11. **Verify** a "Book" button is visible and enabled
12. Take a screenshot of the collapsed booking engine

### Part 3: Expanding the Calendar

13. Click on the check-in date button to expand the booking engine
14. **Verify** the calendar slides down with animation
15. **Verify** the calendar displays the current month with month/year header
16. **Verify** day names are shown (Su, Mo, Tu, We, Th, Fr, Sa)
17. **Verify** all dates in the month are displayed
18. **Verify** blocked dates are greyed out and have strikethrough styling
19. **Verify** available dates are clickable with hover effect
20. **Verify** the selected check-in and check-out dates are highlighted
21. **Verify** the date range between check-in and check-out is highlighted
22. **Verify** a close button (✕) is visible
23. Take a screenshot of the expanded calendar view

### Part 4: Date Selection

24. Click on the "previous month" button in the calendar header
25. **Verify** the calendar navigates to the previous month
26. Click on the "next month" button twice to go to the next month
27. **Verify** the calendar navigates forward
28. Identify an available date (not blocked, not in the past)
29. Click on the available date to select it as check-in
30. **Verify** the check-in date updates at the top of the expanded view
31. **Verify** the clicked date is now highlighted as check-in
32. Identify another available date after the check-in date
33. Click on the second available date to select it as check-out
34. **Verify** the check-out date updates at the top of the expanded view
35. **Verify** the date range between check-in and check-out is highlighted
36. Take a screenshot showing the selected date range

### Part 5: Person Count

37. **Verify** a person count input field is visible with default value 1
38. Click on the person count input field
39. Clear the input and type "2"
40. **Verify** the person count updates to 2
41. Try typing "3" in the person count field
42. **Verify** the person count is capped at 2 (or rejects the input)

### Part 6: Collapsing and Booking

43. Click the close button (✕) to collapse the booking engine
44. **Verify** the calendar collapses with animation
45. **Verify** the collapsed view shows the updated check-in and check-out dates
46. **Verify** the "Book" button is still visible and enabled
47. Take a screenshot of the collapsed view with updated dates
48. Click the "Book" button
49. **Verify** a new browser tab opens with the Airbnb booking URL
50. Close the new tab and return to the booking page

### Part 7: Room 2 Validation

51. Navigate to `/booking/room2` to test the second room
52. **Verify** the booking engine loads for Room 2
53. **Verify** Room 2 has different iCal feeds (may show different blocked dates)
54. **Verify** the booking engine functions the same way for Room 2
55. Take a screenshot of Room 2 booking engine

### Part 8: Error Handling (Optional)

56. Open browser developer tools and disable network connection (offline mode)
57. Refresh the page or navigate to `/booking/room1` again
58. **Verify** an error message is displayed (e.g., "Unable to fetch availability")
59. **Verify** the booking engine gracefully handles the error
60. Re-enable network connection

## Success Criteria

- Booking engine loads and displays first 2 available nights by default
- Collapsed state shows check-in/check-out dates and book button
- Expanding the calendar shows full month view with blocked and available dates
- Calendar allows month navigation (previous/next)
- User can select new check-in and check-out dates
- Selected date range is visually highlighted
- Person count input validates (1-2 persons only)
- Close button collapses the calendar back to collapsed state
- Book button opens Airbnb URL in new tab
- Booking engine works for both Room 1 and Room 2
- Error state is handled gracefully when iCal feeds fail
- 5 screenshots are taken at key steps

## Edge Cases to Verify

1. **Blocked dates are not selectable**: Try clicking on a blocked date and verify it does nothing
2. **Past dates are not selectable**: Try clicking on a date in the past and verify it's blocked
3. **Check-out must be after check-in**: Select check-in, then try selecting a check-out before it (should reset)
4. **No available dates**: If room is fully booked for 90 days, error message should display
5. **Partial feed failure**: If some iCal feeds fail but others succeed, booking engine should still work with a warning

## Notes

- This test uses real iCal data from Airbnb, Booking.com, and VRBO
- Blocked dates will vary depending on actual bookings
- The test should be flexible enough to work with any availability scenario
- Focus on UI behavior and interactions, not specific dates
- Screenshots help validate visual design matches mockups
