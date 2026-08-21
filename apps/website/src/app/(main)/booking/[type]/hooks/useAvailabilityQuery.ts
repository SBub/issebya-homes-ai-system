import { startSpan } from "@sentry/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { findFirstAvailableNights, isValidDateRange, mergeDateRanges } from "@/lib/date-utils";
import { addBookingBreadcrumb } from "@/lib/sentry-booking";
import type { DateRange } from "@/lib/shared/types/booking";

type AvailabilityResponse = {
  bookings: { start: string; end: string }[];
  error?: string;
};

type AvailabilityData = {
  blockedDates: DateRange[];
  checkInDate: Date | null;
  checkOutDate: Date | null;
  error?: string;
};

export function useAvailabilityQuery(roomType: "room1" | "room2") {
  const queryClient = useQueryClient();

  const query = useQuery<AvailabilityData>({
    queryKey: ["availability", roomType],
    queryFn: async () => {
      return startSpan(
        {
          name: "booking.fetch_availability",
          op: "http.client",
          attributes: {
            "http.url": `/api/availability?room=${roomType}`,
            "booking.roomType": roomType,
          },
        },
        async (span) => {
          addBookingBreadcrumb("Fetching availability", { roomType });

          const response = await fetch(`/api/availability?room=${roomType}`);

          if (!response.ok) {
            span?.setStatus({
              code: 2,
              message: "Failed to fetch availability",
            });
            addBookingBreadcrumb(
              "Availability fetch failed",
              { roomType, status: response.status },
              "error",
            );
            throw new Error("Failed to fetch availability data");
          }

          const data: AvailabilityResponse = await response.json();

          const rawBookings = data.bookings.map((range) => ({
            start: new Date(range.start),
            end: new Date(range.end),
          }));
          const blockedDates = mergeDateRanges(rawBookings);

          span?.setAttribute("booking.blockedRanges", blockedDates.length);
          addBookingBreadcrumb("Availability loaded", {
            roomType,
            blockedRanges: blockedDates.length,
          });

          const firstAvailable = findFirstAvailableNights(blockedDates, 2);

          return {
            blockedDates,
            checkInDate: firstAvailable?.start ?? null,
            checkOutDate: firstAvailable?.end ?? null,
            error: data.error,
          };
        },
      );
    },
  });

  const blockedDates = useMemo(() => query.data?.blockedDates ?? [], [query.data?.blockedDates]);
  const checkInDate = query.data?.checkInDate ?? null;
  const checkOutDate = query.data?.checkOutDate ?? null;

  const setCheckIn = useCallback(
    (checkIn: Date | null) => {
      queryClient.setQueryData<AvailabilityData>(["availability", roomType], (old) =>
        old ? { ...old, checkInDate: checkIn } : old,
      );
    },
    [queryClient, roomType],
  );

  const setCheckOut = useCallback(
    (checkOut: Date | null) => {
      queryClient.setQueryData<AvailabilityData>(["availability", roomType], (old) =>
        old ? { ...old, checkOutDate: checkOut } : old,
      );
    },
    [queryClient, roomType],
  );

  const validateRange = useCallback(
    (checkIn: Date, checkOut: Date): boolean => {
      return isValidDateRange(checkIn, checkOut, blockedDates);
    },
    [blockedDates],
  );

  return {
    blockedDates,
    checkInDate,
    checkOutDate,
    isLoading: query.isLoading,
    error: query.error?.message ?? query.data?.error ?? null,
    setCheckIn,
    setCheckOut,
    validateRange,
  };
}
