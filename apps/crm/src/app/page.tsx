"use client";

// v1 CRM dashboard — a preview UI, explicitly not a finished product. Rows =
// guest_contacts (GET /api/guest-contacts), clicking a row shows that
// guest's full CRM fields plus their WhatsApp conversation history (GET
// /api/guest-contacts/[id]/conversations, which proxies server-side to
// apps/guest-communication-agent). No search/pagination — deferred to a
// later pass. Phone is the one inline-editable field (PATCH
// /api/guest-contacts/[id]) — no editing of name/funnel stage/etc.
//
// Selection is keyed on guest_contacts.id (always present), not phone —
// phone can be null (a guest synced from finance history with no WhatsApp
// number yet), and a null-phone row must still open the detail panel so a
// phone can be attached to it. Only the conversation-history fetch is
// conditional on phone being truthy.
//
// API-key field follows apps/finance/src/app/upload/page.tsx's exact
// pattern (password-style input, held in local state, sent as X-API-Key on
// every fetch) — this page only ever talks to CRM's own endpoints above, so
// only CRM_API_KEY ever reaches the browser. GCA's own API key stays
// entirely server-side, inside the proxy route.

import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Switch,
  Table,
  Tabs,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";

type FunnelStage = "new" | "informed" | "link_sent" | "booked";
type Platform = "airbnb" | "booking_com" | "direct";
type StayLengthBucket = "long_term" | "short_term";

interface GuestContact {
  id: string;
  phone: string | null;
  guest_name: string | null;
  guest_name_normalized: string | null;
  last_room: string | null;
  last_stay_checkin: string | null;
  last_stay_checkout: string | null;
  total_stays: number;
  platform: Platform;
  funnel_stage: FunnelStage;
  last_interaction_at: string | null;
  link_sent_at: string | null;
  stage_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface Conversation {
  id: string;
  status: "active" | "closed";
  started_at: string;
  closed_at: string | null;
  messages: ConversationMessage[];
}

// Campaigns tab — a list + enable/disable + run-now view over campaigns
// rows that already exist (seeded via migration; see
// apps/crm/src/lib/campaigns.ts's own Campaign interface and doc comment).
// Deliberately NOT a campaign-creation form: defining new targeting
// criteria/message templates through the UI is separate, later work.
interface Campaign {
  id: string;
  name: string;
  kind: string;
  target_funnel_stage: string | null;
  min_idle_days: number | null;
  target_stay_before: string | null;
  min_total_stays: number | null;
  discount_percent: number | null;
  offer_description: string;
  message_template: string;
  is_recurring: boolean;
  enabled: boolean;
  created_at: string;
}

interface CampaignRunResult {
  drafted: number;
  skipped: number;
}

// Plain-English summary of whichever targeting columns are non-null on a
// campaign row — joined with a comma when more than one is set. Mirrors
// getCampaignCandidates' own "null criterion isn't applied as a filter"
// logic (apps/crm/src/lib/campaigns.ts) purely for display, not filtering.
function summarizeCampaignTargeting(campaign: Campaign): string {
  const parts: string[] = [];
  if (campaign.target_funnel_stage != null) {
    parts.push(
      campaign.min_idle_days != null
        ? `Funnel stage: ${campaign.target_funnel_stage}, idle ${campaign.min_idle_days}+ days`
        : `Funnel stage: ${campaign.target_funnel_stage}`,
    );
  } else if (campaign.min_idle_days != null) {
    parts.push(`Idle ${campaign.min_idle_days}+ days`);
  }
  if (campaign.target_stay_before != null) {
    parts.push(`Last stay before ${formatDateOnly(campaign.target_stay_before)}`);
  }
  if (campaign.min_total_stays != null) {
    parts.push(`Total stays ≥ ${campaign.min_total_stays}`);
  }
  return parts.length > 0 ? parts.join(", ") : "No targeting criteria set";
}

// discount_percent takes priority over offer_description (a campaign with
// both set would only ever have discount_percent actually interpolated by
// renderCampaignMessage — see campaign-messages.ts), then falls back to
// offer_description if non-empty, then "—".
function summarizeCampaignOffer(campaign: Campaign): string {
  if (campaign.discount_percent != null) {
    return `${campaign.discount_percent}% off`;
  }
  if (campaign.offer_description) {
    return campaign.offer_description;
  }
  return "—";
}

const FUNNEL_STAGE_COLOR: Record<FunnelStage, "gray" | "blue" | "amber" | "green"> = {
  new: "gray",
  informed: "blue",
  link_sent: "amber",
  booked: "green",
};

// "direct" is finance's own value for a non-OTA, direct/website booking (see
// supabase/migrations/20260718213027_finance_bookings.sql's finance_platform
// enum) — guest_contacts.platform reuses that exact value rather than
// inventing a parallel vocabulary (see this migration's own comment:
// supabase/migrations/*_add_platform_to_guest_contacts.sql). "Direct" here
// is purely a display label for that same stored value, not a different
// value.
const PLATFORM_LABEL: Record<Platform, string> = {
  airbnb: "Airbnb",
  booking_com: "Booking",
  direct: "Direct",
};

const PLATFORM_COLOR: Record<Platform, "red" | "blue" | "gray"> = {
  airbnb: "red",
  booking_com: "blue",
  direct: "gray",
};

const FUNNEL_STAGE_FILTER_OPTIONS: { value: FunnelStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "informed", label: "Informed" },
  { value: "link_sent", label: "Link sent" },
  { value: "booked", label: "Booked" },
];

const PLATFORM_FILTER_OPTIONS: { value: Platform; label: string }[] = [
  { value: "airbnb", label: "Airbnb" },
  { value: "booking_com", label: "Booking" },
  { value: "direct", label: "Direct" },
];

const STAY_LENGTH_FILTER_OPTIONS: { value: StayLengthBucket; label: string }[] = [
  { value: "long_term", label: "Long-term (7+ nights)" },
  { value: "short_term", label: "Short-term (<7 nights)" },
];

const ROOM_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "room_1", label: "Room 1" },
  { value: "room_2", label: "Room 2" },
];

// Shared day-diff math, used by stayLengthBucket below and the "Nights"
// table column — a guest missing either date has no computable stay length.
// Both dates are plain YYYY-MM-DD strings (finance_bookings.checkin_date/
// checkout_date are `date`, not `timestamptz`), so new Date(...) on each
// parses as UTC midnight and the difference is already a whole number of
// nights.
function nightsBetween(
  checkin: string | null | undefined,
  checkout: string | null | undefined,
): number | null {
  if (!checkin || !checkout) {
    return null;
  }
  return Math.round(
    (new Date(checkout).getTime() - new Date(checkin).getTime()) / (1000 * 60 * 60 * 24),
  );
}

// Hidden derived column (see its columnDef below) never renders a header or
// cell — it exists purely so stay length can be filtered through TanStack
// Table's own columnFilters state instead of a separate ad-hoc mechanism.
// A guest with no stay dates at all (a phone-only stub with no finance
// history) buckets as null, matching neither filter chip.
function stayLengthBucket(guest: GuestContact): StayLengthBucket | null {
  const nights = nightsBetween(guest.last_stay_checkin, guest.last_stay_checkout);
  if (nights === null) {
    return null;
  }
  return nights >= 7 ? "long_term" : "short_term";
}

// Shared OR-within-dimension filter for the stay-length/platform/funnel-stage
// chip groups below: a row matches a dimension if its column value is one of
// the values currently toggled on for that dimension (or if none are
// toggled on at all, per toggleFilterValue dropping empty dimensions from
// columnFilters entirely). Deliberately not TanStack's built-in
// `arrIncludesSome` — that filter expects the ROW's own value to be an
// array and calls `.includes()` on it (right for tag-like columns), whereas
// every column filtered here holds a single scalar value; the array here is
// the filter's selected options, not the row's data.
const filterValueIncludes: FilterFn<GuestContact> = (row, columnId, filterValue: unknown) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) {
    return true;
  }
  return filterValue.includes(row.getValue(columnId));
};

// Hides the stay_length_bucket column from every header/cell render without
// touching sorting/filtering — TanStack Table's own column-visibility
// mechanism, not a manual exclude-by-id check in the render loop. Declared
// once, outside the component: static, since nothing on this page ever
// offers to toggle it back on.
const COLUMN_VISIBILITY = { stay_length_bucket: false };

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

// Date-only variant, used specifically for the Last Stay column and the
// detail panel's "Last stay" line — a stay's check-in/check-out NIGHT is
// what matters there, unlike last_interaction_at/link_sent_at (when someone
// last messaged), which keep using formatDate's full date+time below.
function formatDateOnly(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleDateString();
}

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState("");

  // Campaigns tab state — kept separate from the CRM tab's guest state
  // below, both sharing only `apiKey`. campaignRunResults/campaignRunErrors/
  // campaignRunLoading are keyed by campaign id (one row's "Run now" action
  // shouldn't affect any other row's own inline result/loading state).
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [hasLoadedCampaigns, setHasLoadedCampaigns] = useState(false);
  const [campaignToggleErrors, setCampaignToggleErrors] = useState<Record<string, string>>({});
  const [campaignTogglingIds, setCampaignTogglingIds] = useState<Set<string>>(new Set());
  const [campaignRunLoadingIds, setCampaignRunLoadingIds] = useState<Set<string>>(new Set());
  const [campaignRunResults, setCampaignRunResults] = useState<Record<string, CampaignRunResult>>(
    {},
  );
  const [campaignRunErrors, setCampaignRunErrors] = useState<Record<string, string>>({});
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());

  const [guests, setGuests] = useState<GuestContact[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestsError, setGuestsError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  // Mirrors selectedGuestId synchronously, same reason as editingGuestIdRef
  // below. Guards a real race: if a guest is selected (kicking off a
  // conversation-history fetch), then a different guest is selected before
  // that fetch resolves, the first fetch's late response must not overwrite
  // the second guest's already-showing panel with stale content/errors.
  const selectedGuestIdRef = useRef<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([]);
  // Filter chips (stay length / platform / funnel stage) are plain
  // TanStack Table columnFilters — each dimension is one ColumnFilter entry
  // keyed by column id, whose value is the array of currently-toggled-on
  // option values for that dimension (see toggleFilterValue and
  // filterValueIncludes above).
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Inline phone edit — only one cell can be in edit mode at a time, tracked
  // by guest id rather than per-row state.
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  // Mirrors editingGuestId synchronously (unlike the state value, which only
  // updates on the next render). Needed because a successful commit closes
  // the input, and browsers fire a native blur on an input removed from the
  // DOM while focused — that stale onBlur closure would otherwise re-invoke
  // commitPhoneEdit a second time for the same edit. Checking this ref at
  // the top of commitPhoneEdit makes that second, stale call a no-op.
  const editingGuestIdRef = useRef<string | null>(null);

  const closeEditing = useCallback(() => {
    editingGuestIdRef.current = null;
    setEditingGuestId(null);
  }, []);

  async function loadGuests() {
    setGuestsLoading(true);
    setGuestsError(null);
    try {
      const res = await fetch("/api/guest-contacts", { headers: { "X-API-Key": apiKey } });
      const json = await res.json();
      if (!res.ok) {
        setGuestsError(typeof json.error === "string" ? json.error : "Failed to load guests");
        setGuests([]);
        return;
      }
      setGuests((json.guests ?? []) as GuestContact[]);
      setHasLoaded(true);
    } catch (err) {
      setGuestsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGuestsLoading(false);
    }
  }

  // Mirrors loadGuests' own loading/error/hasLoaded pattern exactly, just
  // against GET /api/campaigns instead — the "explicit load button" pattern
  // this page uses elsewhere rather than a new auto-fetch convention.
  async function loadCampaigns() {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const res = await fetch("/api/campaigns", { headers: { "X-API-Key": apiKey } });
      const json = await res.json();
      if (!res.ok) {
        setCampaignsError(typeof json.error === "string" ? json.error : "Failed to load campaigns");
        setCampaigns([]);
        return;
      }
      setCampaigns((json.campaigns ?? []) as Campaign[]);
      setHasLoadedCampaigns(true);
    } catch (err) {
      setCampaignsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCampaignsLoading(false);
    }
  }

  // Toggling a campaign's enabled Switch — confirmation-based (not
  // optimistic): the Switch only flips once PATCH /api/campaigns/[id]
  // actually confirms the write, so a failed toggle visibly snaps back
  // rather than silently drifting from the server's real state. Per-campaign
  // loading state (campaignTogglingIds) disables that row's own Switch while
  // in flight without affecting any other row.
  const toggleCampaignEnabled = useCallback(
    async (campaign: Campaign, nextEnabled: boolean) => {
      setCampaignTogglingIds((prev) => new Set(prev).add(campaign.id));
      setCampaignToggleErrors((prev) => {
        const { [campaign.id]: _removed, ...rest } = prev;
        return rest;
      });
      try {
        const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}`, {
          method: "PATCH",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        });
        const json = await res.json();
        if (!res.ok) {
          setCampaignToggleErrors((prev) => ({
            ...prev,
            [campaign.id]: typeof json.error === "string" ? json.error : "Failed to save",
          }));
          return;
        }
        const updatedEnabled = (json.enabled ?? nextEnabled) as boolean;
        setCampaigns((prev) =>
          prev.map((c) => (c.id === campaign.id ? { ...c, enabled: updatedEnabled } : c)),
        );
      } catch (err) {
        setCampaignToggleErrors((prev) => ({
          ...prev,
          [campaign.id]: err instanceof Error ? err.message : "Unknown error",
        }));
      } finally {
        setCampaignTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(campaign.id);
          return next;
        });
      }
    },
    [apiKey],
  );

  // "Run now" per campaign row — POST /api/campaigns/[id]/run, which only
  // drafts promo codes and pushes them to Telegram for human approval; it
  // never itself sends anything to a guest (see that route's own doc
  // comment). Result/error is shown inline near the row that triggered it,
  // keyed by campaign id like every other per-row action state here.
  const runCampaignNow = useCallback(
    async (campaign: Campaign) => {
      setCampaignRunLoadingIds((prev) => new Set(prev).add(campaign.id));
      setCampaignRunErrors((prev) => {
        const { [campaign.id]: _removed, ...rest } = prev;
        return rest;
      });
      setCampaignRunResults((prev) => {
        const { [campaign.id]: _removed, ...rest } = prev;
        return rest;
      });
      try {
        const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/run`, {
          method: "POST",
          headers: { "X-API-Key": apiKey },
        });
        const json = await res.json();
        if (!res.ok) {
          setCampaignRunErrors((prev) => ({
            ...prev,
            [campaign.id]: typeof json.error === "string" ? json.error : "Failed to run campaign",
          }));
          return;
        }
        setCampaignRunResults((prev) => ({
          ...prev,
          [campaign.id]: { drafted: json.drafted as number, skipped: json.skipped as number },
        }));
      } catch (err) {
        setCampaignRunErrors((prev) => ({
          ...prev,
          [campaign.id]: err instanceof Error ? err.message : "Unknown error",
        }));
      } finally {
        setCampaignRunLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(campaign.id);
          return next;
        });
      }
    },
    [apiKey],
  );

  const toggleMessageExpanded = useCallback((campaignId: string) => {
    setExpandedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
      }
      return next;
    });
  }, []);

  const loadConversationsFor = useCallback(
    async (guestId: string) => {
      setConversationsLoading(true);
      try {
        const res = await fetch(
          `/api/guest-contacts/${encodeURIComponent(guestId)}/conversations`,
          {
            headers: { "X-API-Key": apiKey },
          },
        );
        const json = await res.json();
        if (selectedGuestIdRef.current !== guestId) {
          // A different guest was selected while this request was in
          // flight — this response is stale, discard it rather than
          // overwriting whatever the now-selected guest's own panel shows.
          return;
        }
        if (!res.ok) {
          setConversationsError(
            typeof json.error === "string" ? json.error : "Failed to load conversation history",
          );
          return;
        }
        setConversations((json.conversations ?? []) as Conversation[]);
      } catch (err) {
        if (selectedGuestIdRef.current === guestId) {
          setConversationsError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (selectedGuestIdRef.current === guestId) {
          setConversationsLoading(false);
        }
      }
    },
    [apiKey],
  );

  async function selectGuest(guest: GuestContact) {
    setSelectedGuestId(guest.id);
    selectedGuestIdRef.current = guest.id;
    setConversations(null);
    setConversationsError(null);
    if (!guest.phone) {
      // No phone yet — nothing to fetch conversation history for. The
      // detail panel itself still renders (see render logic below), it just
      // shows a "no phone yet" message in the conversation-history section.
      return;
    }
    await loadConversationsFor(guest.id);
  }

  // Mirrors selectGuest's own resets (conversations/conversationsError/
  // conversationsLoading back to their initial values), plus clearing
  // selectedGuestId itself — selectGuest never does that since it's always
  // selecting a real guest, never deselecting.
  const closeGuestDetail = useCallback(() => {
    selectedGuestIdRef.current = null;
    setSelectedGuestId(null);
    setConversations(null);
    setConversationsError(null);
    setConversationsLoading(false);
  }, []);

  const startEditingPhone = useCallback((guest: GuestContact, event: MouseEvent) => {
    event.stopPropagation();
    editingGuestIdRef.current = guest.id;
    setEditingGuestId(guest.id);
    setEditingValue(guest.phone ?? "");
    setEditingError(null);
  }, []);

  const commitPhoneEdit = useCallback(
    async (guestId: string) => {
      if (editingGuestIdRef.current !== guestId) {
        // Already committed (or cancelled) by a prior call for this same
        // edit — see editingGuestIdRef's own comment above.
        return;
      }

      const value = editingValue.trim();
      setEditingSaving(true);
      setEditingError(null);
      try {
        const res = await fetch(`/api/guest-contacts/${encodeURIComponent(guestId)}`, {
          method: "PATCH",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ phone: value }),
        });
        const json = await res.json();
        if (!res.ok) {
          setEditingError(typeof json.error === "string" ? json.error : "Failed to save phone");
          return;
        }
        const updatedPhone = (json.phone ?? value) as string;
        setGuests((prev) =>
          prev.map((guest) => (guest.id === guestId ? { ...guest, phone: updatedPhone } : guest)),
        );
        closeEditing();
        setEditingValue("");
        // If the guest whose phone we just saved is also the one currently
        // selected, the detail panel's conversation-history section was
        // either showing "no phone yet" (first time a phone is added) or
        // conversations for the guest's previous phone (a correction) —
        // either way it's now stale. Re-fetch so it reflects the new value
        // immediately instead of only updating on the next row click.
        if (selectedGuestId === guestId) {
          await loadConversationsFor(guestId);
        }
      } catch (err) {
        setEditingError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setEditingSaving(false);
      }
    },
    [editingValue, apiKey, closeEditing, selectedGuestId, loadConversationsFor],
  );

  // Toggles `value` in/out of the active filter set for `columnId` (one
  // TanStack columnFilters entry per dimension). Removing the last value in
  // a dimension drops that entry entirely rather than leaving an
  // empty-array filter around, so an empty dimension truly doesn't filter
  // at all (per filterValueIncludes' own early-return).
  const toggleFilterValue = useCallback((columnId: string, value: string) => {
    setColumnFilters((prev) => {
      const existing = prev.find((filter) => filter.id === columnId);
      const currentValues = Array.isArray(existing?.value) ? (existing.value as string[]) : [];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((v) => v !== value)
        : [...currentValues, value];
      const withoutColumn = prev.filter((filter) => filter.id !== columnId);
      return nextValues.length === 0
        ? withoutColumn
        : [...withoutColumn, { id: columnId, value: nextValues }];
    });
  }, []);

  const isFilterValueActive = useCallback(
    (columnId: string, value: string) => {
      const existing = columnFilters.find((filter) => filter.id === columnId);
      return Array.isArray(existing?.value) && (existing.value as string[]).includes(value);
    },
    [columnFilters],
  );

  const columns = useMemo<ColumnDef<GuestContact>[]>(
    () => [
      {
        accessorKey: "guest_name",
        header: "Name",
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: (info) => {
          const guest = info.row.original;
          if (editingGuestId === guest.id) {
            return (
              <Box onClick={(e) => e.stopPropagation()}>
                <TextField.Root
                  autoFocus
                  size="1"
                  value={editingValue}
                  disabled={editingSaving}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void commitPhoneEdit(guest.id);
                    }
                  }}
                  onBlur={() => void commitPhoneEdit(guest.id)}
                />
                {editingError && (
                  <Text as="div" size="1" color="red" mt="1">
                    {editingError}
                  </Text>
                )}
              </Box>
            );
          }
          if (guest.phone) {
            return (
              <Flex align="center" gap="2">
                <Text>{guest.phone}</Text>
                <Button
                  size="1"
                  variant="ghost"
                  aria-label="Edit phone"
                  onClick={(e) => startEditingPhone(guest, e)}
                >
                  ✎
                </Button>
              </Flex>
            );
          }
          return (
            <Button size="1" variant="soft" onClick={(e) => startEditingPhone(guest, e)}>
              Edit
            </Button>
          );
        },
      },
      {
        accessorKey: "funnel_stage",
        header: "Funnel Stage",
        filterFn: filterValueIncludes,
        cell: (info) => {
          const stage = info.getValue() as FunnelStage;
          return <Badge color={FUNNEL_STAGE_COLOR[stage]}>{stage}</Badge>;
        },
      },
      {
        accessorKey: "last_room",
        header: "Last Room",
        filterFn: filterValueIncludes,
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "platform",
        header: "Platform",
        filterFn: filterValueIncludes,
        cell: (info) => {
          const platform = info.getValue() as Platform;
          return <Badge color={PLATFORM_COLOR[platform]}>{PLATFORM_LABEL[platform]}</Badge>;
        },
      },
      {
        // Sorts by checkout date (see sortingFn below) but the cell shows
        // only the check-in date — the fuller checkin–checkout range still
        // lives in the detail panel, but a single date reads better in a
        // dense table row now that the Nights and Last Room columns give
        // complementary context. This is the field that matters most for
        // deciding whether (and what) to send a returning-guest campaign to
        // — surfaced here, sortable across the whole guest list, rather
        // than only visible one guest at a time in the detail panel. Dates
        // only, no time — see formatDateOnly's own comment above.
        accessorKey: "last_stay_checkin",
        header: "Last Stay",
        // Sorts by checkout date, not the accessor's own checkin value —
        // checkout is the more useful sort key (e.g. "who left most
        // recently"), even though the cell itself only displays checkin.
        // Both dates are plain YYYY-MM-DD strings, so lexical comparison is
        // correct. Nulls (no stay history) compare as "" — an empty string
        // sorts before any real date, so those guests land first ascending
        // / last descending, consistently regardless of sort direction.
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.last_stay_checkout ?? "";
          const b = rowB.original.last_stay_checkout ?? "";
          return a < b ? -1 : a > b ? 1 : 0;
        },
        cell: (info) => {
          const guest = info.row.original;
          if (!guest.last_stay_checkin) {
            return "—";
          }
          return formatDateOnly(guest.last_stay_checkin);
        },
      },
      {
        // Real, visible, plain-sortable column — derived the same way as
        // the hidden stay_length_bucket column below (accessorFn, no single
        // source field), except this one renders. No dedicated filter: the
        // existing "Stay length" long-term/short-term chips already filter
        // on the derived bucket, this column is just for at-a-glance
        // scanning of the raw night count.
        id: "nights",
        accessorFn: (guest) => nightsBetween(guest.last_stay_checkin, guest.last_stay_checkout),
        header: "Nights",
        cell: (info) => {
          const nights = info.getValue() as number | null;
          return nights === null ? "—" : nights;
        },
      },
      {
        accessorKey: "total_stays",
        header: "Total Stays",
      },
      {
        accessorKey: "last_interaction_at",
        header: "Last Interaction",
        cell: (info) => formatDate(info.getValue() as string | null),
      },
      {
        // Hidden derived column — see stayLengthBucket's own comment above.
        // Exists only to be filtered via columnFilters (see
        // COLUMN_VISIBILITY), never rendered as a header/cell.
        id: "stay_length_bucket",
        accessorFn: stayLengthBucket,
        enableHiding: true,
        filterFn: filterValueIncludes,
      },
    ],
    [editingGuestId, editingValue, editingSaving, editingError, commitPhoneEdit, startEditingPhone],
  );

  const table = useReactTable({
    data: guests,
    columns,
    state: { sorting, columnFilters, columnVisibility: COLUMN_VISIBILITY },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedGuest = guests.find((guest) => guest.id === selectedGuestId) ?? null;

  return (
    <Box p="5">
      <Heading size="6" mb="4">
        CRM Dashboard
      </Heading>

      <Flex gap="3" align="end" mb="5">
        <Box>
          <Text as="label" htmlFor="api-key" size="2" weight="medium">
            CRM API Key
          </Text>
          <Box mt="1">
            <TextField.Root
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="X-API-Key"
            />
          </Box>
        </Box>
        <Button onClick={loadGuests} disabled={guestsLoading || !apiKey}>
          {guestsLoading ? "Loading…" : "Load guests"}
        </Button>
      </Flex>

      <Tabs.Root defaultValue="crm">
        <Tabs.List mb="4">
          <Tabs.Trigger value="crm">CRM</Tabs.Trigger>
          <Tabs.Trigger value="campaigns">Campaigns</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="crm">
          {guestsError && (
            <Text as="p" color="red" mb="3">
              {guestsError}
            </Text>
          )}

          {guests.length > 0 && (
            <>
              <Flex direction="column" gap="3" mb="4">
                <Box>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Stay length
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    {STAY_LENGTH_FILTER_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        size="1"
                        color="gray"
                        highContrast
                        variant={
                          isFilterValueActive("stay_length_bucket", option.value) ? "solid" : "soft"
                        }
                        onClick={() => toggleFilterValue("stay_length_bucket", option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>
                </Box>
                <Box>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Platform
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    {PLATFORM_FILTER_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        size="1"
                        color="gray"
                        highContrast
                        variant={isFilterValueActive("platform", option.value) ? "solid" : "soft"}
                        onClick={() => toggleFilterValue("platform", option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>
                </Box>
                <Box>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Funnel stage
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    {FUNNEL_STAGE_FILTER_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        size="1"
                        color="gray"
                        highContrast
                        variant={
                          isFilterValueActive("funnel_stage", option.value) ? "solid" : "soft"
                        }
                        onClick={() => toggleFilterValue("funnel_stage", option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>
                </Box>
                <Box>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Room
                  </Text>
                  <Flex gap="2" wrap="wrap">
                    {ROOM_FILTER_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        size="1"
                        color="gray"
                        highContrast
                        variant={isFilterValueActive("last_room", option.value) ? "solid" : "soft"}
                        onClick={() => toggleFilterValue("last_room", option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Flex>
                </Box>
              </Flex>

              <Text as="p" size="2" color="gray" mb="2">
                Showing {table.getFilteredRowModel().rows.length} of {guests.length} guests
              </Text>
            </>
          )}

          <Flex gap="5" align="start">
            <Box flexGrow="1" style={{ minWidth: 0 }}>
              {!hasLoaded && !guestsLoading && (
                <Text color="gray">Enter the CRM API key and click "Load guests" to begin.</Text>
              )}
              {hasLoaded && guests.length === 0 && <Text color="gray">No guests yet.</Text>}
              {guests.length > 0 && (
                <Table.Root variant="surface">
                  <Table.Header>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <Table.Row key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          const sortState = header.column.getIsSorted();
                          return (
                            <Table.ColumnHeaderCell
                              key={header.id}
                              onClick={header.column.getToggleSortingHandler()}
                              style={{ cursor: "pointer", userSelect: "none" }}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <span
                                style={{
                                  display: "inline-block",
                                  width: "1em",
                                  textAlign: "center",
                                }}
                              >
                                {sortState === "asc" ? "▲" : sortState === "desc" ? "▼" : ""}
                              </span>
                            </Table.ColumnHeaderCell>
                          );
                        })}
                      </Table.Row>
                    ))}
                  </Table.Header>
                  <Table.Body>
                    {table.getRowModel().rows.map((row) => (
                      <Table.Row
                        key={row.id}
                        onClick={() => void selectGuest(row.original)}
                        style={{
                          cursor: "pointer",
                          backgroundColor:
                            row.original.id === selectedGuestId ? "var(--accent-a3)" : undefined,
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <Table.Cell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              )}
            </Box>

            {selectedGuestId && (
              <Box style={{ flexShrink: 0, width: 380, position: "sticky", top: 24 }}>
                <Flex direction="column" gap="3">
                  <Card>
                    <Flex justify="between" align="center" mb="2">
                      <Heading size="4">{selectedGuest?.guest_name ?? "Unnamed guest"}</Heading>
                      <Button
                        size="1"
                        variant="ghost"
                        color="gray"
                        aria-label="Close"
                        onClick={closeGuestDetail}
                      >
                        ✕
                      </Button>
                    </Flex>
                    <Flex direction="column" gap="1">
                      <Text as="div" size="2">
                        Phone: {selectedGuest?.phone ?? "—"}
                      </Text>
                      <Text as="div" size="2">
                        Funnel stage:{" "}
                        {selectedGuest && (
                          <Badge color={FUNNEL_STAGE_COLOR[selectedGuest.funnel_stage]}>
                            {selectedGuest.funnel_stage}
                          </Badge>
                        )}
                      </Text>
                      <Text as="div" size="2">
                        Last room: {selectedGuest?.last_room ?? "—"}
                      </Text>
                      <Text as="div" size="2">
                        Platform:{" "}
                        {selectedGuest && (
                          <Badge color={PLATFORM_COLOR[selectedGuest.platform]}>
                            {PLATFORM_LABEL[selectedGuest.platform]}
                          </Badge>
                        )}
                      </Text>
                      <Text as="div" size="2">
                        Last stay: {formatDateOnly(selectedGuest?.last_stay_checkin)} –{" "}
                        {formatDateOnly(selectedGuest?.last_stay_checkout)}
                      </Text>
                      <Text as="div" size="2">
                        Total stays: {selectedGuest?.total_stays ?? 0}
                      </Text>
                      <Text as="div" size="2">
                        Last interaction: {formatDate(selectedGuest?.last_interaction_at)}
                      </Text>
                      <Text as="div" size="2">
                        Link sent at: {formatDate(selectedGuest?.link_sent_at)}
                      </Text>
                    </Flex>
                  </Card>

                  <Heading size="3">Conversation history</Heading>
                  {!selectedGuest?.phone && (
                    <Text color="gray">
                      No phone number yet — add one to see conversation history.
                    </Text>
                  )}
                  {conversationsLoading && <Text color="gray">Loading…</Text>}
                  {conversationsError && <Text color="red">{conversationsError}</Text>}
                  {conversations && conversations.length === 0 && (
                    <Text color="gray">No WhatsApp conversations yet.</Text>
                  )}
                  {conversations?.map((conversation) => (
                    <Card key={conversation.id}>
                      <Text as="div" size="2" weight="medium" mb="2">
                        {conversation.status} — started {formatDate(conversation.started_at)}
                      </Text>
                      <Flex direction="column" gap="2">
                        {conversation.messages.map((message) => (
                          <Box
                            key={message.id}
                            style={{
                              alignSelf: message.role === "user" ? "flex-start" : "flex-end",
                              backgroundColor:
                                message.role === "user" ? "var(--gray-a3)" : "var(--accent-a4)",
                              borderRadius: "var(--radius-3)",
                              padding: "6px 10px",
                              maxWidth: "85%",
                            }}
                          >
                            <Text as="div" size="1" color="gray">
                              {message.role} · {formatDate(message.created_at)}
                            </Text>
                            <Text as="div" size="2">
                              {message.content}
                            </Text>
                          </Box>
                        ))}
                      </Flex>
                    </Card>
                  ))}
                </Flex>
              </Box>
            )}
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="campaigns">
          <Flex gap="3" align="end" mb="4">
            <Button onClick={loadCampaigns} disabled={campaignsLoading || !apiKey}>
              {campaignsLoading ? "Loading…" : "Load campaigns"}
            </Button>
          </Flex>

          {campaignsError && (
            <Text as="p" color="red" mb="3">
              {campaignsError}
            </Text>
          )}

          {!hasLoadedCampaigns && !campaignsLoading && (
            <Text color="gray">Click "Load campaigns" to begin.</Text>
          )}
          {hasLoadedCampaigns && campaigns.length === 0 && (
            <Text color="gray">No campaigns yet.</Text>
          )}

          <Flex direction="column" gap="3">
            {campaigns.map((campaign) => {
              const isToggling = campaignTogglingIds.has(campaign.id);
              const isRunning = campaignRunLoadingIds.has(campaign.id);
              const runResult = campaignRunResults[campaign.id];
              const runError = campaignRunErrors[campaign.id];
              const toggleError = campaignToggleErrors[campaign.id];
              const isMessageExpanded = expandedMessageIds.has(campaign.id);

              return (
                <Card key={campaign.id}>
                  <Flex justify="between" align="start" mb="2" gap="3">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Heading size="3">{campaign.name}</Heading>
                      <Badge color="gray">{campaign.kind}</Badge>
                      <Badge color={campaign.is_recurring ? "green" : "amber"}>
                        {campaign.is_recurring ? "Automated" : "One-off"}
                      </Badge>
                    </Flex>
                    <Flex direction="column" align="end" gap="1" style={{ flexShrink: 0 }}>
                      <Flex align="center" gap="2">
                        <Text size="2" color="gray">
                          {campaign.enabled ? "Enabled" : "Disabled"}
                        </Text>
                        <Switch
                          checked={campaign.enabled}
                          disabled={isToggling}
                          onCheckedChange={(checked) =>
                            void toggleCampaignEnabled(campaign, checked)
                          }
                        />
                      </Flex>
                      {toggleError && (
                        <Text size="1" color="red">
                          {toggleError}
                        </Text>
                      )}
                    </Flex>
                  </Flex>

                  <Flex direction="column" gap="1" mb="3">
                    <Text as="div" size="2">
                      <Text weight="medium">Targeting: </Text>
                      {summarizeCampaignTargeting(campaign)}
                    </Text>
                    <Text as="div" size="2">
                      <Text weight="medium">Offer: </Text>
                      {summarizeCampaignOffer(campaign)}
                    </Text>
                    <Box>
                      <Text as="div" size="2" weight="medium">
                        Message
                      </Text>
                      <Text
                        as="div"
                        size="2"
                        color="gray"
                        style={
                          isMessageExpanded
                            ? { maxWidth: 560 }
                            : {
                                maxWidth: 560,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }
                        }
                      >
                        {campaign.message_template}
                      </Text>
                      <Button
                        size="1"
                        variant="ghost"
                        onClick={() => toggleMessageExpanded(campaign.id)}
                      >
                        {isMessageExpanded ? "Show less" : "Show full message"}
                      </Button>
                    </Box>
                  </Flex>

                  <Flex align="center" gap="3">
                    <Button
                      size="1"
                      onClick={() => void runCampaignNow(campaign)}
                      disabled={isRunning}
                    >
                      {isRunning ? "Running…" : "Run now"}
                    </Button>
                    {runResult && (
                      <Text size="2" color="green">
                        Drafted {runResult.drafted}, skipped {runResult.skipped}
                      </Text>
                    )}
                    {runError && (
                      <Text size="2" color="red">
                        {runError}
                      </Text>
                    )}
                  </Flex>
                </Card>
              );
            })}
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
