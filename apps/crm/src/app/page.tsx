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
  Dialog,
  Flex,
  Heading,
  Switch,
  Table,
  Tabs,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type Row,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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
  // How many people (adults + children, infants excluded) stayed during the
  // most recent booking — carried over verbatim from finance_bookings.guests
  // by the same "most recent by checkin_date" sync logic as last_room/
  // platform/last_stay_checkin/last_stay_checkout (see
  // apps/crm/src/lib/finance-sync.ts). Null for a phone-only stub guest with
  // no finance history yet, same reason last_room/last_stay_checkin/
  // last_stay_checkout are nullable too.
  last_stay_guests: number | null;
  platform: Platform;
  funnel_stage: FunnelStage;
  last_interaction_at: string | null;
  link_sent_at: string | null;
  stage_updated_at: string | null;
  // Whether this guest is eligible for campaign targeting — see
  // getCampaignCandidates (apps/crm/src/lib/campaigns.ts). Set false for a
  // guest who wasn't happy with their stay and shouldn't be bothered by
  // campaigns again; toggled from the CRM tab's own Enabled column below.
  enabled: boolean;
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
  // How many guests would actually be drafted right now if "Run now" were
  // clicked — countUndraftedCandidates' result (apps/crm/src/lib/
  // campaigns.ts), baked into every row by GET /api/campaigns itself. Always
  // present on a campaign fetched from that endpoint (unlike campaigns.ts's
  // own Campaign interface, where this is optional since a raw DB row never
  // has it) — this is the frontend's own copy of the type, describing only
  // what the API response actually contains.
  candidate_count: number;
}

// A dismissible toast-style banner — see notifications state below. Kept
// deliberately tiny (message + a success/error tone) rather than a generic
// severity enum, since today's only producer (runCampaignNow) only ever has
// these two outcomes.
interface Notification {
  id: string;
  message: string;
  tone: "success" | "error";
}

// Local form state for the "+ New Campaign" dialog — every field is a
// string (including the number/date inputs) so a blank input can be told
// apart from "0"/an explicit value; createCampaign below parses/omits each
// one when building the POST body. isRecurring is the one real boolean,
// since it's driven by a Switch rather than a text input.
interface NewCampaignForm {
  name: string;
  kind: string;
  isRecurring: boolean;
  targetFunnelStage: string;
  minIdleDays: string;
  targetStayBefore: string;
  minTotalStays: string;
  discountPercent: string;
  offerDescription: string;
  messageTemplate: string;
}

const EMPTY_NEW_CAMPAIGN_FORM: NewCampaignForm = {
  name: "",
  kind: "",
  isRecurring: false,
  targetFunnelStage: "",
  minIdleDays: "",
  targetStayBefore: "",
  minTotalStays: "",
  discountPercent: "",
  offerDescription: "",
  messageTemplate: "",
};

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

// Campaigns tab's own chip dimensions — values are stringified booleans
// ("true"/"false") since is_recurring/enabled are boolean columns and
// filterValueIncludes below compares stringified row values against
// stringified filter values.
const CAMPAIGN_TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "true", label: "Automated" },
  { value: "false", label: "One-off" },
];

const CAMPAIGN_ENABLED_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "true", label: "Enabled" },
  { value: "false", label: "Disabled" },
];

// Explicit per-column pixel widths, applied alongside `tableLayout: "fixed"`
// on each table's Table.Root below. Radix's Table.Root otherwise renders a
// plain HTML <table> with the browser default `table-layout: auto`, which
// recomputes every column's width from scratch based on ONLY the
// currently-visible rows' content — so toggling a filter chip to a
// different row subset reflows every column, not just the ones whose own
// data changed (confirmed by measuring getBoundingClientRect() on header
// cells before/after filtering). Keyed by column id (accessorKey, or the
// explicit `id` for derived columns) and looked up in each
// Table.ColumnHeaderCell's own inline style. Values are today's natural
// (unfiltered) column widths, so the fixed layout still matches the
// pre-existing design rather than introducing a visual regression.
const CRM_COLUMN_WIDTHS: Record<string, number> = {
  guest_name: 232,
  phone: 96,
  funnel_stage: 151,
  enabled: 110,
  last_room: 130,
  platform: 115,
  last_stay_checkin: 120,
  nights: 98,
  last_stay_guests: 90,
  total_stays: 134,
  last_interaction_at: 173,
};

const CAMPAIGN_COLUMN_WIDTHS: Record<string, number> = {
  name: 195,
  kind: 187,
  is_recurring: 100,
  enabled: 85,
  targeting: 159,
  candidate_count: 118,
  offer: 184,
  message_template: 327,
  actions: 124,
};

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

// Shared OR-within-dimension filter for every chip-group dimension on this
// page (CRM tab's stay-length/platform/funnel-stage/room chips, Campaigns
// tab's type/enabled chips): a row matches a dimension if its column value
// — stringified, so boolean columns like is_recurring/enabled compare
// correctly against the string values chip buttons toggle — is one of the
// values currently toggled on for that dimension (or if none are toggled on
// at all, per toggleColumnFilterValue dropping empty dimensions from
// columnFilters entirely). Deliberately not TanStack's built-in
// `arrIncludesSome` — that filter expects the ROW's own value to be an
// array and calls `.includes()` on it (right for tag-like columns), whereas
// every column filtered here holds a single scalar value; the array here is
// the filter's selected options, not the row's data. Generic over TData so
// both the GuestContact and Campaign tables share one implementation
// instead of near-duplicate copies — instantiate as
// `filterValueIncludes<GuestContact>` / `filterValueIncludes<Campaign>` at
// each columnDef's `filterFn`.
function filterValueIncludes<TData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  if (!Array.isArray(filterValue) || filterValue.length === 0) {
    return true;
  }
  return filterValue.map(String).includes(String(row.getValue(columnId)));
}

// Toggles `value` in/out of the active filter set for `columnId`, against
// whichever ColumnFiltersState setter is passed in — shared by the CRM
// tab's own columnFilters and the Campaigns tab's own campaignsColumnFilters
// (see toggleFilterValue/toggleCampaignFilterValue below). Each dimension is
// one TanStack columnFilters entry. Removing the last value in a dimension
// drops that entry entirely rather than leaving an empty-array filter
// around, so an empty dimension truly doesn't filter at all (per
// filterValueIncludes' own early-return).
function toggleColumnFilterValue(
  setFilters: Dispatch<SetStateAction<ColumnFiltersState>>,
  columnId: string,
  value: string,
) {
  setFilters((prev) => {
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
}

function isColumnFilterValueActive(
  filters: ColumnFiltersState,
  columnId: string,
  value: string,
): boolean {
  const existing = filters.find((filter) => filter.id === columnId);
  return Array.isArray(existing?.value) && (existing.value as string[]).includes(value);
}

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

  // Fixed-position toast stack (see the Box rendered near the top of the
  // JSX tree below, outside Tabs.Root so it's visible regardless of which
  // tab is active) — today's one producer is runCampaignNow's own
  // success/error paths, replacing what used to be inline "Drafted N,
  // skipped M" text in the Campaigns table's Actions cell (that text
  // overflowed the column's fixed 124px width — see CAMPAIGN_COLUMN_WIDTHS
  // above). showNotification appends and schedules its own auto-dismiss;
  // dismissNotification additionally backs the banner's own manual "✕".
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  const showNotification = useCallback(
    (message: string, tone: Notification["tone"]) => {
      const id = crypto.randomUUID();
      setNotifications((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => dismissNotification(id), 5000);
    },
    [dismissNotification],
  );

  // Campaigns tab state — kept separate from the CRM tab's guest state
  // below, both sharing only `apiKey`. campaignRunLoadingIds is keyed by
  // campaign id (one row's "Run now" action shouldn't affect any other
  // row's own loading state) — the run's own result/error now surfaces via
  // showNotification above instead of being kept in per-campaign state here.
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [hasLoadedCampaigns, setHasLoadedCampaigns] = useState(false);
  const [campaignToggleErrors, setCampaignToggleErrors] = useState<Record<string, string>>({});
  const [campaignTogglingIds, setCampaignTogglingIds] = useState<Set<string>>(new Set());
  const [campaignRunLoadingIds, setCampaignRunLoadingIds] = useState<Set<string>>(new Set());
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());
  // Own sorting state for the Campaigns tab's table — deliberately not
  // shared with the CRM tab's own `sorting` state below (two independent
  // useReactTable instances, one per tab).
  const [campaignsSorting, setCampaignsSorting] = useState<SortingState>([]);
  // Campaigns tab's own filter chips (Type / Enabled) — mirrors the CRM
  // tab's columnFilters below but kept separate, same reason as
  // campaignsSorting above.
  const [campaignsColumnFilters, setCampaignsColumnFilters] = useState<ColumnFiltersState>([]);
  // "+ New Campaign" dialog state — a plain create form (POST
  // /api/campaigns), separate from every other Campaigns-tab state above.
  const [isNewCampaignOpen, setIsNewCampaignOpen] = useState(false);
  const [newCampaignForm, setNewCampaignForm] = useState<NewCampaignForm>(EMPTY_NEW_CAMPAIGN_FORM);
  const [newCampaignSubmitting, setNewCampaignSubmitting] = useState(false);
  const [newCampaignError, setNewCampaignError] = useState<string | null>(null);
  // NLP-assisted draft ("Describe your campaign" + Generate, above the
  // manual fields) — POST /api/campaigns/parse. Deliberately separate
  // loading/error state from newCampaignSubmitting/newCampaignError above:
  // generating a draft and submitting the (now-prefilled, still editable)
  // form below are two independent actions that can each be in flight or
  // fail on their own. Generating never auto-submits — it only calls
  // updateNewCampaignForm per returned field, same as if the user had typed
  // each one by hand; the user still has to review and click "Create"
  // themselves, same human-in-the-loop principle as the Telegram
  // approve/reject flow for actual message sends.
  const [parseCampaignDescription, setParseCampaignDescription] = useState("");
  const [parseCampaignLoading, setParseCampaignLoading] = useState(false);
  const [parseCampaignError, setParseCampaignError] = useState<string | null>(null);

  const [guests, setGuests] = useState<GuestContact[]>([]);
  const [guestsLoading, setGuestsLoading] = useState(false);
  const [guestsError, setGuestsError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  // Per-guest enabled/disabled toggle state — mirrors
  // campaignTogglingIds/campaignToggleErrors above exactly, just keyed by
  // guest id instead of campaign id (see toggleGuestEnabled below).
  const [guestToggleErrors, setGuestToggleErrors] = useState<Record<string, string>>({});
  const [guestTogglingIds, setGuestTogglingIds] = useState<Set<string>>(new Set());

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
  // against GET /api/campaigns instead. Unlike loadGuests (still behind the
  // CRM tab's explicit "Load guests" button), this is auto-fetched — see
  // the useEffect right below — so it's a useCallback rather than a plain
  // function, to give that effect a stable dependency.
  const loadCampaigns = useCallback(async () => {
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
  }, [apiKey]);

  // Auto-loads campaigns once apiKey has a value, rather than requiring an
  // explicit "Load campaigns" click. Debounced (600ms of no further apiKey
  // changes) rather than firing on the first keystroke that makes apiKey
  // non-empty — firing immediately on "any non-empty value" was a real bug:
  // typing (or this page's own automation tooling filling the field
  // character-by-character) briefly makes apiKey a single incomplete
  // character, which 401s once, and since apiKey never becomes empty again
  // afterward, an "empty-to-non-empty transition" guard can never re-fire —
  // the rest of the real key being typed in would never trigger a retry.
  // Debouncing avoids needing to detect "done typing" any other way: every
  // apiKey change resets the timer via the cleanup function, so only a
  // settled value actually triggers the fetch. hasLoadedCampaigns/
  // campaignsLoading still guard duplicate/overlapping fetches once a real
  // attempt is in flight or has already succeeded. The CRM tab's own "Load
  // guests" button is untouched — this auto-load is Campaigns-only.
  useEffect(() => {
    if (apiKey.length === 0 || hasLoadedCampaigns || campaignsLoading) {
      return;
    }
    const timeoutId = setTimeout(() => {
      void loadCampaigns();
    }, 600);
    return () => clearTimeout(timeoutId);
  }, [apiKey, hasLoadedCampaigns, campaignsLoading, loadCampaigns]);

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
  // comment). Result/error surfaces as a toast (showNotification above)
  // rather than inline table text — the Actions column's fixed 124px width
  // (CAMPAIGN_COLUMN_WIDTHS) can't fit "Drafted N, skipped M" without
  // overflowing/truncating mid-word.
  const runCampaignNow = useCallback(
    async (campaign: Campaign) => {
      setCampaignRunLoadingIds((prev) => new Set(prev).add(campaign.id));
      try {
        const res = await fetch(`/api/campaigns/${encodeURIComponent(campaign.id)}/run`, {
          method: "POST",
          headers: { "X-API-Key": apiKey },
        });
        const json = await res.json();
        if (!res.ok) {
          showNotification(
            typeof json.error === "string" ? json.error : "Failed to run campaign",
            "error",
          );
          return;
        }
        showNotification(
          `Drafted ${json.drafted as number}, skipped ${json.skipped as number} for ${campaign.name}`,
          "success",
        );
      } catch (err) {
        showNotification(err instanceof Error ? err.message : "Unknown error", "error");
      } finally {
        setCampaignRunLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(campaign.id);
          return next;
        });
      }
    },
    [apiKey, showNotification],
  );

  // Toggling a guest's enabled Switch (CRM tab) — optimistic, unlike
  // toggleCampaignEnabled above: the local `guests` array's `enabled` value
  // flips immediately (before the PATCH resolves), rather than waiting for
  // server confirmation. A failed request reverts that guest's `enabled`
  // back to whatever it was before the optimistic flip and surfaces the
  // error via guestToggleErrors, same as before. guestTogglingIds still
  // disables just that row's own Switch while the request is in flight.
  // This is the UI for the "guest wasn't happy with their stay, don't
  // bother them with campaigns again" case — already enforced server-side
  // by getCampaignCandidates, this just lets it be set.
  const toggleGuestEnabled = useCallback(
    async (guest: GuestContact, nextEnabled: boolean) => {
      const previousEnabled = guest.enabled;
      setGuestTogglingIds((prev) => new Set(prev).add(guest.id));
      setGuestToggleErrors((prev) => {
        const { [guest.id]: _removed, ...rest } = prev;
        return rest;
      });
      setGuests((prev) =>
        prev.map((g) => (g.id === guest.id ? { ...g, enabled: nextEnabled } : g)),
      );
      try {
        const res = await fetch(`/api/guest-contacts/${encodeURIComponent(guest.id)}`, {
          method: "PATCH",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        });
        const json = await res.json();
        if (!res.ok) {
          setGuestToggleErrors((prev) => ({
            ...prev,
            [guest.id]: typeof json.error === "string" ? json.error : "Failed to save",
          }));
          setGuests((prev) =>
            prev.map((g) => (g.id === guest.id ? { ...g, enabled: previousEnabled } : g)),
          );
          return;
        }
        const updatedEnabled = (json.enabled ?? nextEnabled) as boolean;
        setGuests((prev) =>
          prev.map((g) => (g.id === guest.id ? { ...g, enabled: updatedEnabled } : g)),
        );
      } catch (err) {
        setGuestToggleErrors((prev) => ({
          ...prev,
          [guest.id]: err instanceof Error ? err.message : "Unknown error",
        }));
        setGuests((prev) =>
          prev.map((g) => (g.id === guest.id ? { ...g, enabled: previousEnabled } : g)),
        );
      } finally {
        setGuestTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(guest.id);
          return next;
        });
      }
    },
    [apiKey],
  );

  // NLP-assisted draft: POST /api/campaigns/parse with the free-text
  // description, then prefills newCampaignForm with whatever fields the
  // response contains — via updateNewCampaignForm's own setter shape (an
  // object spread that only overwrites returned fields), so any field the
  // user already typed by hand before clicking Generate, or that the
  // description didn't support, is left untouched rather than blanked out.
  // Every value comes back type-checked by the endpoint itself (see
  // POST /api/campaigns/parse's own validateCampaignDraft), so this only
  // needs to convert number fields back to the form's own string
  // representation — same convention createCampaign below reverses on the
  // way out.
  const generateCampaignDraft = useCallback(async () => {
    const description = parseCampaignDescription.trim();
    if (!description) {
      setParseCampaignError("Describe the campaign first.");
      return;
    }

    setParseCampaignLoading(true);
    setParseCampaignError(null);
    try {
      const res = await fetch("/api/campaigns/parse", {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!res.ok) {
        setParseCampaignError(
          typeof json.error === "string" ? json.error : "Failed to generate campaign draft",
        );
        return;
      }
      setNewCampaignForm((prev) => ({
        ...prev,
        ...(typeof json.name === "string" ? { name: json.name } : {}),
        ...(typeof json.kind === "string" ? { kind: json.kind } : {}),
        ...(typeof json.is_recurring === "boolean" ? { isRecurring: json.is_recurring } : {}),
        ...(typeof json.target_funnel_stage === "string"
          ? { targetFunnelStage: json.target_funnel_stage }
          : {}),
        ...(typeof json.min_idle_days === "number"
          ? { minIdleDays: String(json.min_idle_days) }
          : {}),
        ...(typeof json.target_stay_before === "string"
          ? { targetStayBefore: json.target_stay_before }
          : {}),
        ...(typeof json.min_total_stays === "number"
          ? { minTotalStays: String(json.min_total_stays) }
          : {}),
        ...(typeof json.discount_percent === "number"
          ? { discountPercent: String(json.discount_percent) }
          : {}),
        ...(typeof json.offer_description === "string"
          ? { offerDescription: json.offer_description }
          : {}),
        ...(typeof json.message_template === "string"
          ? { messageTemplate: json.message_template }
          : {}),
      }));
    } catch (err) {
      setParseCampaignError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setParseCampaignLoading(false);
    }
  }, [apiKey, parseCampaignDescription]);

  // Creates a new campaign (POST /api/campaigns) from the "+ New Campaign"
  // dialog's form state. Only fields with a value are sent — an empty
  // optional input is omitted entirely rather than sent as "" or NaN, since
  // the backend treats undefined/missing as "not set" but would 400 on an
  // explicit empty string or a malformed type. `enabled` is deliberately
  // never sent — the backend always defaults new campaigns to enabled.
  const createCampaign = useCallback(async () => {
    const name = newCampaignForm.name.trim();
    const kind = newCampaignForm.kind.trim();
    const messageTemplate = newCampaignForm.messageTemplate.trim();
    if (!name || !kind || !messageTemplate) {
      setNewCampaignError("Name, kind, and message template are required.");
      return;
    }

    setNewCampaignSubmitting(true);
    setNewCampaignError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        kind,
        message_template: messageTemplate,
        is_recurring: newCampaignForm.isRecurring,
      };
      const targetFunnelStage = newCampaignForm.targetFunnelStage.trim();
      if (targetFunnelStage) {
        body.target_funnel_stage = targetFunnelStage;
      }
      if (newCampaignForm.minIdleDays.trim()) {
        const parsed = Number(newCampaignForm.minIdleDays);
        if (!Number.isNaN(parsed)) {
          body.min_idle_days = parsed;
        }
      }
      if (newCampaignForm.targetStayBefore.trim()) {
        body.target_stay_before = newCampaignForm.targetStayBefore.trim();
      }
      if (newCampaignForm.minTotalStays.trim()) {
        const parsed = Number(newCampaignForm.minTotalStays);
        if (!Number.isNaN(parsed)) {
          body.min_total_stays = parsed;
        }
      }
      if (newCampaignForm.discountPercent.trim()) {
        const parsed = Number(newCampaignForm.discountPercent);
        if (!Number.isNaN(parsed)) {
          body.discount_percent = parsed;
        }
      }
      const offerDescription = newCampaignForm.offerDescription.trim();
      if (offerDescription) {
        body.offer_description = offerDescription;
      }

      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setNewCampaignError(
          typeof json.error === "string" ? json.error : "Failed to create campaign",
        );
        return;
      }
      setCampaigns((prev) => [...prev, json as Campaign]);
      setIsNewCampaignOpen(false);
      setNewCampaignForm(EMPTY_NEW_CAMPAIGN_FORM);
    } catch (err) {
      setNewCampaignError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setNewCampaignSubmitting(false);
    }
  }, [apiKey, newCampaignForm]);

  // Dialog open/close handler — closing (via Cancel, the X, or a
  // successful create) always clears the form and any stale error, so
  // reopening the dialog later starts fresh.
  const handleNewCampaignOpenChange = useCallback((open: boolean) => {
    setIsNewCampaignOpen(open);
    if (!open) {
      setNewCampaignForm(EMPTY_NEW_CAMPAIGN_FORM);
      setNewCampaignError(null);
      setParseCampaignDescription("");
      setParseCampaignError(null);
    }
  }, []);

  const updateNewCampaignForm = useCallback(
    <K extends keyof NewCampaignForm>(field: K, value: NewCampaignForm[K]) => {
      setNewCampaignForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
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

  // Thin wrappers around the shared toggleColumnFilterValue/
  // isColumnFilterValueActive helpers above, bound to this tab's own
  // columnFilters state. See campaignsColumnFilters' own pair below for the
  // Campaigns tab's equivalent.
  const toggleFilterValue = useCallback(
    (columnId: string, value: string) => toggleColumnFilterValue(setColumnFilters, columnId, value),
    [],
  );

  const isFilterValueActive = useCallback(
    (columnId: string, value: string) => isColumnFilterValueActive(columnFilters, columnId, value),
    [columnFilters],
  );

  // Campaigns tab's own filter-chip toggling (Type / Enabled), against
  // campaignsColumnFilters instead of the CRM tab's columnFilters — same
  // shared helpers, separate state.
  const toggleCampaignFilterValue = useCallback(
    (columnId: string, value: string) =>
      toggleColumnFilterValue(setCampaignsColumnFilters, columnId, value),
    [],
  );

  const isCampaignFilterValueActive = useCallback(
    (columnId: string, value: string) =>
      isColumnFilterValueActive(campaignsColumnFilters, columnId, value),
    [campaignsColumnFilters],
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
                <Flex align="center" gap="1">
                  <TextField.Root
                    autoFocus
                    size="1"
                    value={editingValue}
                    disabled={editingSaving}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void commitPhoneEdit(guest.id);
                      } else if (e.key === "Escape") {
                        closeEditing();
                      }
                    }}
                    onBlur={() => void commitPhoneEdit(guest.id)}
                  />
                  <Button
                    size="1"
                    variant="ghost"
                    color="gray"
                    aria-label="Cancel edit"
                    disabled={editingSaving}
                    // Prevents the TextField from blurring when this button
                    // is pressed — without this, mousedown-driven focus loss
                    // fires onBlur (and thus commitPhoneEdit) before this
                    // button's own onClick ever runs, so the edit would
                    // still commit instead of being discarded.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => closeEditing()}
                  >
                    ✕
                  </Button>
                </Flex>
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
        filterFn: filterValueIncludes<GuestContact>,
        cell: (info) => {
          const stage = info.getValue() as FunnelStage;
          return <Badge color={FUNNEL_STAGE_COLOR[stage]}>{stage}</Badge>;
        },
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        cell: (info) => {
          const guest = info.row.original;
          const isToggling = guestTogglingIds.has(guest.id);
          const toggleError = guestToggleErrors[guest.id];
          return (
            <Flex direction="column" gap="1" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={guest.enabled}
                disabled={isToggling}
                onCheckedChange={(checked) => void toggleGuestEnabled(guest, checked)}
              />
              {toggleError && (
                <Text size="1" color="red">
                  {toggleError}
                </Text>
              )}
            </Flex>
          );
        },
      },
      {
        accessorKey: "last_room",
        header: "Last Room",
        filterFn: filterValueIncludes<GuestContact>,
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "platform",
        header: "Platform",
        filterFn: filterValueIncludes<GuestContact>,
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
        // How many people (adults + children, infants excluded) stayed
        // during that same most-recent booking — carried over verbatim
        // from finance_bookings.guests (see
        // apps/crm/src/lib/finance-sync.ts). Grouped with the other
        // per-stay detail columns (Last Stay/Nights) rather than Total
        // Stays, since it describes that one stay, not the guest's history
        // as a whole. Null for a phone-only stub guest with no finance
        // history yet, same as Last Stay/Nights above.
        accessorKey: "last_stay_guests",
        header: "Guests",
        cell: (info) => {
          const guestCount = info.getValue() as number | null;
          return guestCount === null ? "—" : guestCount;
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
        filterFn: filterValueIncludes<GuestContact>,
      },
    ],
    [
      editingGuestId,
      editingValue,
      editingSaving,
      editingError,
      commitPhoneEdit,
      closeEditing,
      startEditingPhone,
      guestTogglingIds,
      guestToggleErrors,
      toggleGuestEnabled,
    ],
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

  // Campaigns tab's own columns — mirrors the CRM tab's `columns` useMemo
  // above in shape/conventions, but entirely separate (own state, own
  // accessors) per Campaign rather than GuestContact. Every handler/state
  // referenced in cells below (toggleCampaignEnabled, runCampaignNow,
  // toggleMessageExpanded, campaignTogglingIds, campaignToggleErrors,
  // campaignRunLoadingIds, expandedMessageIds) is the same state declared
  // earlier in this component — this is a rendering-structure change only,
  // not new behavior.
  const campaignColumns = useMemo<ColumnDef<Campaign>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: (info) => info.getValue() as string,
      },
      {
        accessorKey: "kind",
        header: "Kind",
        cell: (info) => <Badge color="gray">{info.getValue() as string}</Badge>,
      },
      {
        accessorKey: "is_recurring",
        header: "Type",
        filterFn: filterValueIncludes<Campaign>,
        cell: (info) => {
          const isRecurring = info.getValue() as boolean;
          return (
            <Badge color={isRecurring ? "green" : "amber"}>
              {isRecurring ? "Automated" : "One-off"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        filterFn: filterValueIncludes<Campaign>,
        cell: (info) => {
          const campaign = info.row.original;
          const isToggling = campaignTogglingIds.has(campaign.id);
          const toggleError = campaignToggleErrors[campaign.id];
          return (
            <Flex direction="column" gap="1">
              <Switch
                checked={campaign.enabled}
                disabled={isToggling}
                onCheckedChange={(checked) => void toggleCampaignEnabled(campaign, checked)}
              />
              {toggleError && (
                <Text size="1" color="red">
                  {toggleError}
                </Text>
              )}
            </Flex>
          );
        },
      },
      {
        id: "targeting",
        accessorFn: (campaign) => summarizeCampaignTargeting(campaign),
        header: "Targeting",
        cell: (info) => info.getValue() as string,
      },
      {
        // How many guests match this campaign's targeting criteria right
        // now and haven't already been nudged by it — i.e. exactly what
        // clicking "Run now" would draft for this instant. Computed
        // server-side (GET /api/campaigns's own candidate_count field, via
        // countUndraftedCandidates in campaigns.ts) rather than re-derived
        // here, since it depends on live guest_contacts/promo_codes state
        // this page doesn't otherwise fetch.
        accessorKey: "candidate_count",
        header: "Would notify",
        cell: (info) => info.getValue() as number,
      },
      {
        id: "offer",
        accessorFn: (campaign) => summarizeCampaignOffer(campaign),
        header: "Offer",
        cell: (info) => info.getValue() as string,
      },
      {
        accessorKey: "message_template",
        header: "Message",
        cell: (info) => {
          const campaign = info.row.original;
          const isMessageExpanded = expandedMessageIds.has(campaign.id);
          return (
            <Box>
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
              <Button size="1" variant="ghost" onClick={() => toggleMessageExpanded(campaign.id)}>
                {isMessageExpanded ? "Show less" : "Show full message"}
              </Button>
            </Box>
          );
        },
      },
      {
        // No natural accessor (this column is pure UI action, not a data
        // field) — disable sorting here rather than let the header's
        // sort-toggle do nothing meaningful. Run result/error no longer
        // renders here — see showNotification/runCampaignNow above; this
        // column's fixed 124px width (CAMPAIGN_COLUMN_WIDTHS) can't fit
        // "Drafted N, skipped M" without truncating mid-word.
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: (info) => {
          const campaign = info.row.original;
          const isRunning = campaignRunLoadingIds.has(campaign.id);
          return (
            <Flex align="center" gap="3">
              {campaign.is_recurring === false ? (
                <Button size="1" onClick={() => void runCampaignNow(campaign)} disabled={isRunning}>
                  {isRunning ? "Running…" : "Run now"}
                </Button>
              ) : (
                <Text color="gray" size="2">
                  Runs automatically
                </Text>
              )}
            </Flex>
          );
        },
      },
    ],
    [
      campaignTogglingIds,
      campaignToggleErrors,
      toggleCampaignEnabled,
      expandedMessageIds,
      toggleMessageExpanded,
      campaignRunLoadingIds,
      runCampaignNow,
    ],
  );

  const campaignsTable = useReactTable({
    data: campaigns,
    columns: campaignColumns,
    state: { sorting: campaignsSorting, columnFilters: campaignsColumnFilters },
    onSortingChange: setCampaignsSorting,
    onColumnFiltersChange: setCampaignsColumnFilters,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <Box p="5">
      {/* Fixed-position toast stack — rendered here, outside Tabs.Root, so
          a campaign run's result/error is visible regardless of which tab
          is active. See showNotification/dismissNotification above. */}
      <Box
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxWidth: 360,
        }}
      >
        {notifications.map((notification) => (
          <Card
            key={notification.id}
            style={{
              borderLeft: `3px solid var(--${notification.tone === "success" ? "green" : "red"}-9)`,
            }}
          >
            <Flex justify="between" align="start" gap="3">
              <Text size="2" color={notification.tone === "success" ? "green" : "red"}>
                {notification.message}
              </Text>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                aria-label="Dismiss notification"
                onClick={() => dismissNotification(notification.id)}
              >
                ✕
              </Button>
            </Flex>
          </Card>
        ))}
      </Box>

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
              <Flex wrap="wrap" gap="7" align="start" mb="4">
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
                <Table.Root variant="surface" style={{ tableLayout: "fixed" }}>
                  <Table.Header>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <Table.Row key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          const sortState = header.column.getIsSorted();
                          return (
                            <Table.ColumnHeaderCell
                              key={header.id}
                              onClick={header.column.getToggleSortingHandler()}
                              style={{
                                cursor: "pointer",
                                userSelect: "none",
                                width: CRM_COLUMN_WIDTHS[header.column.id],
                              }}
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
          <Flex justify="between" align="start" mb="4">
            <Flex wrap="wrap" gap="7" align="start">
              {campaigns.length > 0 && (
                <>
                  <Box>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Type
                    </Text>
                    <Flex gap="2" wrap="wrap">
                      {CAMPAIGN_TYPE_FILTER_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="1"
                          color="gray"
                          highContrast
                          variant={
                            isCampaignFilterValueActive("is_recurring", option.value)
                              ? "solid"
                              : "soft"
                          }
                          onClick={() => toggleCampaignFilterValue("is_recurring", option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </Flex>
                  </Box>
                  <Box>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Enabled
                    </Text>
                    <Flex gap="2" wrap="wrap">
                      {CAMPAIGN_ENABLED_FILTER_OPTIONS.map((option) => (
                        <Button
                          key={option.value}
                          size="1"
                          color="gray"
                          highContrast
                          variant={
                            isCampaignFilterValueActive("enabled", option.value) ? "solid" : "soft"
                          }
                          onClick={() => toggleCampaignFilterValue("enabled", option.value)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </Flex>
                  </Box>
                </>
              )}
            </Flex>
            <Dialog.Root open={isNewCampaignOpen} onOpenChange={handleNewCampaignOpenChange}>
              <Dialog.Trigger>
                <Button>+ New Campaign</Button>
              </Dialog.Trigger>
              <Dialog.Content maxWidth="520px">
                <Dialog.Title>New Campaign</Dialog.Title>
                <Flex direction="column" gap="3">
                  <Box>
                    <Text as="label" size="2" weight="medium" htmlFor="new-campaign-description">
                      Describe your campaign
                    </Text>
                    <Box mt="1">
                      <TextArea
                        id="new-campaign-description"
                        value={parseCampaignDescription}
                        onChange={(e) => setParseCampaignDescription(e.target.value)}
                        placeholder="e.g. Invite past guests who stayed before June, offer them 10% off to come back"
                        rows={3}
                      />
                    </Box>
                    <Flex justify="end" mt="2">
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => void generateCampaignDraft()}
                        disabled={parseCampaignLoading || !parseCampaignDescription.trim()}
                      >
                        {parseCampaignLoading ? "Generating…" : "Generate"}
                      </Button>
                    </Flex>
                    {parseCampaignError && (
                      <Text as="p" size="2" color="red" mt="1">
                        {parseCampaignError}
                      </Text>
                    )}
                  </Box>
                  <Box>
                    <Text as="label" size="2" weight="medium" htmlFor="new-campaign-name">
                      Name
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-name"
                        value={newCampaignForm.name}
                        onChange={(e) => updateNewCampaignForm("name", e.target.value)}
                        placeholder="Campaign name"
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text as="label" size="2" weight="medium" htmlFor="new-campaign-kind">
                      Kind
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-kind"
                        value={newCampaignForm.kind}
                        onChange={(e) => updateNewCampaignForm("kind", e.target.value)}
                        placeholder="Free-text label, e.g. win-back"
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Type
                    </Text>
                    <Flex align="center" gap="2">
                      <Switch
                        checked={newCampaignForm.isRecurring}
                        onCheckedChange={(checked) => updateNewCampaignForm("isRecurring", checked)}
                      />
                      <Text size="2">{newCampaignForm.isRecurring ? "Automated" : "One-off"}</Text>
                    </Flex>
                    <Text as="div" size="1" color="gray" mt="1">
                      One-off: runs once, against whichever guests match right now. Automated: keeps
                      running on a schedule, evaluating newly-matching guests each time.
                    </Text>
                  </Box>
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="new-campaign-target-funnel-stage"
                    >
                      Target funnel stage (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-target-funnel-stage"
                        value={newCampaignForm.targetFunnelStage}
                        onChange={(e) => updateNewCampaignForm("targetFunnelStage", e.target.value)}
                        placeholder="new / informed / link_sent / booked, or leave blank"
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text as="label" size="2" weight="medium" htmlFor="new-campaign-min-idle-days">
                      Min idle days (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-min-idle-days"
                        type="number"
                        value={newCampaignForm.minIdleDays}
                        onChange={(e) => updateNewCampaignForm("minIdleDays", e.target.value)}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="new-campaign-target-stay-before"
                    >
                      Target stay before (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-target-stay-before"
                        type="date"
                        value={newCampaignForm.targetStayBefore}
                        onChange={(e) => updateNewCampaignForm("targetStayBefore", e.target.value)}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="new-campaign-min-total-stays"
                    >
                      Min total stays (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-min-total-stays"
                        type="number"
                        value={newCampaignForm.minTotalStays}
                        onChange={(e) => updateNewCampaignForm("minTotalStays", e.target.value)}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="new-campaign-discount-percent"
                    >
                      Discount percent (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-discount-percent"
                        type="number"
                        value={newCampaignForm.discountPercent}
                        onChange={(e) => updateNewCampaignForm("discountPercent", e.target.value)}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text
                      as="label"
                      size="2"
                      weight="medium"
                      htmlFor="new-campaign-offer-description"
                    >
                      Offer description (optional)
                    </Text>
                    <Box mt="1">
                      <TextField.Root
                        id="new-campaign-offer-description"
                        value={newCampaignForm.offerDescription}
                        onChange={(e) => updateNewCampaignForm("offerDescription", e.target.value)}
                      />
                    </Box>
                  </Box>
                  <Box>
                    <Text as="label" size="2" weight="medium" htmlFor="new-campaign-message">
                      Message template
                    </Text>
                    <Box mt="1">
                      <TextArea
                        id="new-campaign-message"
                        value={newCampaignForm.messageTemplate}
                        onChange={(e) => updateNewCampaignForm("messageTemplate", e.target.value)}
                        placeholder="Supports {{guest_name}}, {{promo_code}}, {{discount_percent}}, {{offer_description}}"
                        rows={4}
                      />
                    </Box>
                  </Box>
                </Flex>

                {newCampaignError && (
                  <Text as="p" size="2" color="red" mt="3">
                    {newCampaignError}
                  </Text>
                )}

                <Flex gap="3" mt="4" justify="end">
                  <Dialog.Close>
                    <Button variant="soft" color="gray" disabled={newCampaignSubmitting}>
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button onClick={() => void createCampaign()} disabled={newCampaignSubmitting}>
                    {newCampaignSubmitting ? "Creating…" : "Create"}
                  </Button>
                </Flex>
              </Dialog.Content>
            </Dialog.Root>
          </Flex>

          {campaignsError && (
            <Text as="p" color="red" mb="3">
              {campaignsError}
            </Text>
          )}

          {!apiKey && !hasLoadedCampaigns && !campaignsLoading && (
            <Text color="gray">Enter the CRM API key above to load campaigns.</Text>
          )}
          {campaignsLoading && <Text color="gray">Loading…</Text>}
          {hasLoadedCampaigns && campaigns.length === 0 && (
            <Text color="gray">No campaigns yet.</Text>
          )}

          {campaigns.length > 0 && (
            <Text as="p" size="2" color="gray" mb="2">
              Showing {campaignsTable.getFilteredRowModel().rows.length} of {campaigns.length}{" "}
              campaigns
            </Text>
          )}

          {campaigns.length > 0 && (
            <Table.Root variant="surface" style={{ tableLayout: "fixed" }}>
              <Table.Header>
                {campaignsTable.getHeaderGroups().map((headerGroup) => (
                  <Table.Row key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const sortState = header.column.getIsSorted();
                      return (
                        <Table.ColumnHeaderCell
                          key={header.id}
                          onClick={header.column.getToggleSortingHandler()}
                          style={{
                            cursor: "pointer",
                            userSelect: "none",
                            width: CAMPAIGN_COLUMN_WIDTHS[header.column.id],
                          }}
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
                {campaignsTable.getRowModel().rows.map((row) => (
                  <Table.Row key={row.id}>
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
        </Tabs.Content>
      </Tabs.Root>
    </Box>
  );
}
