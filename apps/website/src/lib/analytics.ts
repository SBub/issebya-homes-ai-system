// Event property types
export interface PageEventProps {
  page: "Booking" | "Contact";
}

// Initialize Plausible tracker
let initialized = false;

async function initializePlausible() {
  if (typeof window === "undefined") {
    // Server-side: skip initialization
    return false;
  }

  if (!initialized) {
    const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

    if (!domain) {
      console.warn(
        "[Analytics] NEXT_PUBLIC_PLAUSIBLE_DOMAIN is not set. Analytics tracking is disabled.",
      );
      return false;
    }

    try {
      // Dynamic import to avoid SSR issues
      const { init } = await import("@plausible-analytics/tracker");
      init({
        domain,
        autoCapturePageviews: false, // Pageviews handled by script tag in layout.tsx
      });
      initialized = true;
      return true;
    } catch (error) {
      console.warn("[Analytics] Failed to initialize Plausible:", error);
      return false;
    }
  }

  return true;
}

// Helper to safely track events
async function trackEvent(eventName: string, props?: Record<string, string | number>) {
  const isInitialized = await initializePlausible();
  if (!isInitialized) return;

  try {
    // Dynamic import to avoid SSR issues
    const { track } = await import("@plausible-analytics/tracker");

    // Convert all values to strings for Plausible
    const stringProps: Record<string, string> = {};
    if (props) {
      for (const key in props) {
        stringProps[key] = String(props[key]);
      }
    }

    track(eventName, { props: stringProps });
  } catch (error) {
    console.warn(`[Analytics] Failed to track event "${eventName}":`, error);
  }
}

export function trackTabClicked(page: string, tab: string) {
  trackEvent("TabClicked", { page, tab });
}

export function trackGalleryThumbnailClicked(
  imageIndex: number,
  context?: { room?: string; type?: string },
) {
  trackEvent("GalleryThumbnailClicked", {
    imageIndex,
    ...(context?.room && { room: context.room }),
    ...(context?.type && { type: context.type }),
  });
}

export function trackWhatsAppClicked(page: PageEventProps["page"]) {
  trackEvent("WhatsAppClicked", { page });
}

export function trackInstagramClicked() {
  trackEvent("InstagramClicked");
}

export function trackScrolled50(page: string) {
  trackEvent("Scrolled50%", { page });
}

export function trackCalendarOpened() {
  trackEvent("CalendarOpened");
}

export function trackDateSelected(startDate: string, endDate: string) {
  trackEvent("DateSelected", { startDate, endDate });
}

export function trackBookButtonClicked() {
  trackEvent("BookButtonClicked");
}
