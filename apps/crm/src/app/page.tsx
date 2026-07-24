"use client";

// v1 CRM dashboard — a preview UI, explicitly not a finished product. Rows =
// guest_contacts (GET /api/guest-contacts), clicking a row shows that
// guest's full CRM fields plus their WhatsApp conversation history (GET
// /api/guest-contacts/[id]/conversations, which proxies server-side to
// apps/guest-communication-agent). No filters/search/pagination — deferred
// to a later pass. Phone is the one inline-editable field (PATCH
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

import { Badge, Box, Button, Card, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";

type FunnelStage = "new" | "informed" | "link_sent" | "booked";

interface GuestContact {
  id: string;
  phone: string | null;
  guest_name: string | null;
  guest_name_normalized: string | null;
  last_room: string | null;
  last_stay_checkin: string | null;
  last_stay_checkout: string | null;
  total_stays: number;
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

const FUNNEL_STAGE_COLOR: Record<FunnelStage, "gray" | "blue" | "amber" | "green"> = {
  new: "gray",
  informed: "blue",
  link_sent: "amber",
  booked: "green",
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

export default function DashboardPage() {
  const [apiKey, setApiKey] = useState("");

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
        cell: (info) => {
          const stage = info.getValue() as FunnelStage;
          return <Badge color={FUNNEL_STAGE_COLOR[stage]}>{stage}</Badge>;
        },
      },
      {
        accessorKey: "last_room",
        header: "Last Room",
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        // Sorts by check-in date; the cell shows the full check-in–check-out
        // range. This is the field that matters most for deciding whether
        // (and what) to send a returning-guest campaign to — surfaced here,
        // sortable across the whole guest list, rather than only visible one
        // guest at a time in the detail panel.
        accessorKey: "last_stay_checkin",
        header: "Last Stay",
        cell: (info) => {
          const guest = info.row.original;
          if (!guest.last_stay_checkin) {
            return "—";
          }
          return `${formatDate(guest.last_stay_checkin)} – ${formatDate(guest.last_stay_checkout)}`;
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
    ],
    [editingGuestId, editingValue, editingSaving, editingError, commitPhoneEdit, startEditingPhone],
  );

  const table = useReactTable({
    data: guests,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
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

      {guestsError && (
        <Text as="p" color="red" mb="3">
          {guestsError}
        </Text>
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
                          {sortState === "asc" && " ▲"}
                          {sortState === "desc" && " ▼"}
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

        <Box style={{ flexShrink: 0, width: 380 }}>
          {!selectedGuestId && <Text color="gray">Select a guest to see details</Text>}

          {selectedGuestId && (
            <Flex direction="column" gap="3">
              <Card>
                <Heading size="4" mb="2">
                  {selectedGuest?.guest_name ?? "Unnamed guest"}
                </Heading>
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
                    Last stay: {formatDate(selectedGuest?.last_stay_checkin)} –{" "}
                    {formatDate(selectedGuest?.last_stay_checkout)}
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
                <Text color="gray">No phone number yet — add one to see conversation history.</Text>
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
          )}
        </Box>
      </Flex>
    </Box>
  );
}
