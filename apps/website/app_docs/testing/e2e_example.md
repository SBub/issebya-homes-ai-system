# E2E Test: Basic Booking Flow

Test basic booking functionality in the issebya.homes website.

## User Story

As a potential guest
I want to browse available rooms and event spaces
So that I can book accommodations through Airbnb

## Test Steps

1. Navigate to the `Application URL` (http://localhost:3000)
2. Take a screenshot of the initial state
3. **Verify** core UI elements are present:
   - Header with navigation
   - Room listings (Room 1 and Room 2)
   - Private Event Space listing
   - Gallery images
   - Booking buttons (only for room 1 and room 2)

4. Click on the booking button for "Room 1"
5. Take a screenshot of the booking page
6. **Verify** the booking page displays Room 1 details
7. **Verify** booking tabs are present (Desktop or Mobile view)
8. **Verify** the Airbnb booking button is visible
9. Take a screenshot of the booking details
10. **Verify** room amenities and description are displayed
11. Take a screenshot of the complete booking information
12. Navigate back to homepage using header navigation

## Success Criteria

- Homepage loads with all listings visible
- Booking navigation works correctly
- Room details display properly
- Airbnb booking button is present and functional
- Navigation between pages works smoothly
- 3 screenshots are taken
