"use client";

// v1 CRM dashboard — a preview UI, explicitly not a finished product. Rows =
// guest_contacts (GET /api/guest-contacts), clicking a row shows that
// guest's full CRM fields plus their WhatsApp conversation history (GET
// /api/guest-contacts/[phone]/conversations, which proxies server-side to
// apps/guest-communication-agent). No filters/search/pagination/editing —
// all explicitly deferred to a later pass.
//
// API-key field follows apps/finance/src/app/upload/page.tsx's exact
// pattern (password-style input, held in local state, sent as X-API-Key on
// every fetch) — this page only ever talks to CRM's own two new endpoints
// above, so only CRM_API_KEY ever reaches the browser. GCA's own API key
// stays entirely server-side, inside the proxy route.

import { Badge, Box, Button, Card, Flex, Heading, Table, Text, TextField } from "@radix-ui/themes";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

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

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([]);

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

  async function selectGuest(phone: string | null) {
    setSelectedPhone(phone);
    setConversations(null);
    setConversationsError(null);
    if (!phone) {
      return;
    }

    setConversationsLoading(true);
    try {
      const res = await fetch(`/api/guest-contacts/${encodeURIComponent(phone)}/conversations`, {
        headers: { "X-API-Key": apiKey },
      });
      const json = await res.json();
      if (!res.ok) {
        setConversationsError(
          typeof json.error === "string" ? json.error : "Failed to load conversation history",
        );
        return;
      }
      setConversations((json.conversations ?? []) as Conversation[]);
    } catch (err) {
      setConversationsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setConversationsLoading(false);
    }
  }

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
        cell: (info) => (info.getValue() as string | null) ?? "—",
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
        accessorKey: "total_stays",
        header: "Total Stays",
      },
      {
        accessorKey: "last_interaction_at",
        header: "Last Interaction",
        cell: (info) => formatDate(info.getValue() as string | null),
      },
    ],
    [],
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

  const selectedGuest = guests.find((guest) => guest.phone === selectedPhone) ?? null;

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
                    onClick={() => selectGuest(row.original.phone)}
                    style={{
                      cursor: row.original.phone ? "pointer" : "default",
                      backgroundColor:
                        row.original.phone && row.original.phone === selectedPhone
                          ? "var(--accent-a3)"
                          : undefined,
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
          {!selectedPhone && <Text color="gray">Select a guest to see details</Text>}

          {selectedPhone && (
            <Flex direction="column" gap="3">
              <Card>
                <Heading size="4" mb="2">
                  {selectedGuest?.guest_name ?? "Unnamed guest"}
                </Heading>
                <Flex direction="column" gap="1">
                  <Text as="div" size="2">
                    Phone: {selectedPhone}
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
