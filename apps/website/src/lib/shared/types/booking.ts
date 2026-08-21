export enum BookingType {
  room1 = "room1",
  room2 = "room2",
  event = "event",
}

export function isValidBookingType(type: string | undefined): type is BookingType {
  return type === BookingType.room1 || type === BookingType.room2 || type === BookingType.event;
}

export type Booking = {
  id: string;
  access_token: string;
  type: BookingType;
  start: string;
  end: string;
  nights: number;
  people: number;
  price_per_night: number;
  total_amount: number;
  tourist_tax_total: number;
  refundable_until: string;
  email: string;
  status: "pending" | "confirmed";
  payment_intent: string;
  created_at: string;
};

// Booking Engine with iCal Integration Types

export type ICalEvent = {
  dtstart: Date;
  dtend: Date;
  summary: string;
};

export type DateRange = {
  start: Date;
  end: Date;
};

export type AvailabilityData = {
  bookings: DateRange[];
  error?: string;
};

export type BookingEngineState = {
  isExpanded: boolean;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  personCount: number;
  isLoading: boolean;
  error: string | null;
};
