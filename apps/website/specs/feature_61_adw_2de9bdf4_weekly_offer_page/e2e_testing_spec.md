# E2E Test: Weekly Offer Page

Test the weekly offer page functionality in the Issebya Homes website.

## User Story

As a potential guest interested in a weekly stay
I want to view special weekly offer pricing for both rooms with location details and availability
So that I can quickly understand the offer and contact the host on WhatsApp to book

## Test Steps

1. Navigate to the `Application URL` (http://localhost:3000/weekly-offer)
2. Take a screenshot of the initial state
3. **Verify** core UI elements are present:
   - Page title "private room 1" or heading visible
   - Room tabs (Room 1 and Room 2 only, no Event Space)
   - Gallery with room images
   - Weekly pricing information (300€ for 1 person, 400€ for 2 people)
   - Availability dates for Room 1 (08.03 - 05.04)
   - Location section mentioning "Almoçageme"
   - WhatsApp reservation callout

4. **Verify** Room 1 is displayed by default:
   - Room 1 tab is active/highlighted
   - Gallery shows Room 1 images
   - Weekly pricing is displayed
   - Availability dates show "08.03 - 05.04"

5. Take a screenshot of Room 1 view
6. **Verify** nearby attractions section includes:
   - Adraga beach (walking distance)
   - Hiking trails information

7. **Verify** amenities section lists:
   - Supermarket or grocery store
   - Pharmacy
   - Restaurants/cafes

8. **Verify** Airbnb button is present:
   - Button with text related to reviews
   - Links to Airbnb page

9. Click on the "Room 2" tab
10. Take a screenshot of Room 2 view
11. **Verify** Room 2 content is displayed:
    - Gallery updates to show Room 2 images
    - Availability dates show "16.03 - 09.04"
    - Weekly pricing remains the same (300€/400€)
    - Title changes to "private room 2"

12. **Verify** WhatsApp callout is present on both Room 1 and Room 2:
    - Contains message about reserving via WhatsApp
    - Has WhatsApp link with phone number

13. Take a screenshot of the complete Room 2 information

## Success Criteria

- Page loads successfully at /weekly-offer URL
- Room 1 is displayed by default
- Only Room 1 and Room 2 tabs are shown (no Event Space)
- Tab switching works correctly
- Gallery updates when switching between rooms
- Weekly pricing is clearly displayed (300€ for 1 person, 400€ for 2 people)
- Availability dates are specific to each room (Room 1: 08.03-05.04, Room 2: 16.03-09.04)
- Location "Almoçageme" is mentioned
- Nearby attractions include Adraga beach and hiking trails
- Amenities section lists supermarket, pharmacy, restaurants/cafes
- Airbnb button links to room reviews
- WhatsApp callout is present with contact link
- 3 screenshots are taken
