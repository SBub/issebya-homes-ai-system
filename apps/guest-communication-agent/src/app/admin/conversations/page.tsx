"use client";

// Recovery admin page — the only page this app has. Lists whatsapp_
// conversations rows (GET /api/admin/conversations), flags ones with a stuck
// send/turn/owner-decision (see that route's own `stuck` summary), and lets
// an operator drill into one conversation's full message history plus its
// pending owner decisions (GET /api/admin/conversations/[id]/messages) to
// manually recover from any of the three failure classes: a failed
// WhatsApp send (retry-send), an inbound message that never got a turn
// (retrigger-turn), or a relayed-but-unconsumed owner decision
// (pending-decisions/[id]/actions/resolve).
//
// Code conventions (API-key modal, fetch/loading/error state shape,
// @tanstack/react-table usage, Radix component vocabulary) mirror
// apps/crm/src/app/page.tsx closely — same house style, just one table +
// one inline detail panel instead of two tabs of tables.

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
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo, useRef, useState } from "react";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  deliveryStatus: "sent" | "failed" | null;
}

interface ConversationStuckSummary {
  any: boolean;
  failedDelivery: boolean;
  orphanedInbound: boolean;
  pendingDecision: boolean;
}

interface ConversationListItem {
  id: string;
  phone: string;
  status: string;
  startedAt: string;
  closedAt: string | null;
  lastMessage: MessageRow | null;
  stuck: ConversationStuckSummary;
}

interface ConversationDetail {
  id: string;
  phone: string;
  status: string;
  startedAt: string;
  closedAt: string | null;
}

type PendingDecisionResolution =
  | "answered"
  | "approved"
  | "rejected"
  | "timeout"
  | "manually_resolved"
  | null;

interface PendingDecision {
  id: string;
  correlationId: string;
  toolName: "missing_info" | "send_booking_link";
  reason: string | null;
  sentAt: string;
  relayedAt: string | null;
  resolvedAt: string | null;
  resolution: PendingDecisionResolution;
  stuck: boolean;
}

// A dismissible toast-style banner — mirrors apps/crm/src/app/page.tsx's own
// Notification interface/showNotification pattern exactly.
interface Notification {
  id: string;
  message: string;
  tone: "success" | "error";
}

const TOOL_NAME_LABEL: Record<PendingDecision["toolName"], string> = {
  send_booking_link: "Booking approval",
  missing_info: "Missing info",
};

// Matches apps/crm/src/app/page.tsx's own TABLE_PAGE_SIZE constant.
const TABLE_PAGE_SIZE = 20;

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

// First ~60 chars of a message's content, for the table's Last message
// column — the full content is still shown in the detail panel's message
// list.
function truncateMessage(content: string, maxLength = 60): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

export default function ConversationsAdminPage() {
  const [apiKey, setApiKey] = useState("");
  // Starts `true` so a fresh visit (apiKey is always "" on mount) prompts
  // for a key immediately — same pattern as apps/crm/src/app/page.tsx's own
  // isApiKeyDialogOpen/apiKeyDraft pair.
  const [isApiKeyDialogOpen, setIsApiKeyDialogOpen] = useState(true);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  // Filtering is purely client-side over the one `conversations` array
  // already fetched (see filteredConversations below); toggling this never
  // triggers a new fetch.
  const [stuckOnly, setStuckOnly] = useState(false);

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

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  // Mirrors apps/crm/src/app/page.tsx's own selectedGuestIdRef — guards
  // against a second conversation being selected while the first one's
  // detail fetch is still in flight; that stale response must be discarded
  // rather than overwriting the now-selected conversation's panel.
  const selectedConversationIdRef = useRef<string | null>(null);

  const [detailConversation, setDetailConversation] = useState<ConversationDetail | null>(null);
  const [detailMessages, setDetailMessages] = useState<MessageRow[]>([]);
  const [detailPendingDecisions, setDetailPendingDecisions] = useState<PendingDecision[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Per-item loading/disabled state for the three action buttons — mirrors
  // apps/crm/src/app/page.tsx's own campaignRunLoadingIds Set<string>
  // pattern, just one Set per action, each keyed by the id that actually
  // scopes that action (a message id for retry-send since a conversation
  // can show more than one failed-delivery message at once, a conversation
  // id for retrigger-turn, a pending-decision id for resolve).
  const [retryingMessageIds, setRetryingMessageIds] = useState<Set<string>>(new Set());
  const [retriggeringConversationIds, setRetriggeringConversationIds] = useState<Set<string>>(
    new Set(),
  );
  const [resolvingDecisionIds, setResolvingDecisionIds] = useState<Set<string>>(new Set());

  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: TABLE_PAGE_SIZE,
  });
  // Resets pagination back to page 0 whenever the filter toggles — same
  // render-time diffing pattern apps/crm/src/app/page.tsx uses for its own
  // columnFilters-change reset, since the filtered row count can shrink
  // enough that the current page no longer exists.
  const [prevStuckOnly, setPrevStuckOnly] = useState(stuckOnly);
  if (stuckOnly !== prevStuckOnly) {
    setPrevStuckOnly(stuckOnly);
    if (pagination.pageIndex !== 0) {
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    }
  }

  // keyOverride lets the API-key modal's submit call this with the
  // just-entered key directly, rather than relying on `apiKey` state (which
  // wouldn't be visible yet in this same closure) — same reasoning as
  // apps/crm/src/app/page.tsx's own loadGuests.
  const loadConversations = useCallback(
    async (keyOverride?: string) => {
      const key = keyOverride ?? apiKey;
      setConversationsLoading(true);
      setConversationsError(null);
      try {
        const res = await fetch("/api/admin/conversations?limit=200", {
          headers: { "X-API-Key": key },
        });
        const json = await res.json();
        if (!res.ok) {
          setConversationsError(
            typeof json.error === "string" ? json.error : "Failed to load conversations",
          );
          setConversations([]);
          return;
        }
        setConversations((json.conversations ?? []) as ConversationListItem[]);
        setHasLoaded(true);
      } catch (err) {
        setConversationsError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setConversationsLoading(false);
      }
    },
    [apiKey],
  );

  function handleApiKeyDialogOpenChange(open: boolean) {
    setIsApiKeyDialogOpen(open);
    if (open) {
      setApiKeyDraft(apiKey);
    }
  }

  function submitApiKey() {
    const key = apiKeyDraft.trim();
    if (!key) {
      return;
    }
    setApiKey(key);
    setIsApiKeyDialogOpen(false);
    void loadConversations(key);
  }

  const loadDetailFor = useCallback(
    async (conversationId: string) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(
          `/api/admin/conversations/${encodeURIComponent(conversationId)}/messages`,
          { headers: { "X-API-Key": apiKey } },
        );
        const json = await res.json();
        if (selectedConversationIdRef.current !== conversationId) {
          // A different conversation was selected while this request was in
          // flight — discard this stale response.
          return;
        }
        if (!res.ok) {
          setDetailError(
            typeof json.error === "string" ? json.error : "Failed to load conversation",
          );
          return;
        }
        setDetailConversation(json.conversation as ConversationDetail);
        setDetailMessages((json.messages ?? []) as MessageRow[]);
        setDetailPendingDecisions((json.pendingDecisions ?? []) as PendingDecision[]);
      } catch (err) {
        if (selectedConversationIdRef.current === conversationId) {
          setDetailError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (selectedConversationIdRef.current === conversationId) {
          setDetailLoading(false);
        }
      }
    },
    [apiKey],
  );

  async function selectConversation(conversation: ConversationListItem) {
    setSelectedConversationId(conversation.id);
    selectedConversationIdRef.current = conversation.id;
    setDetailConversation(null);
    setDetailMessages([]);
    setDetailPendingDecisions([]);
    setDetailError(null);
    await loadDetailFor(conversation.id);
  }

  const closeConversationDetail = useCallback(() => {
    selectedConversationIdRef.current = null;
    setSelectedConversationId(null);
    setDetailConversation(null);
    setDetailMessages([]);
    setDetailPendingDecisions([]);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  // Retries the conversation's most recent failed-delivery message. The
  // backend itself always retries "the most recent failed one" for the
  // conversation regardless of which message's own button was clicked (see
  // POST .../actions/retry-send) — a conversation with more than one failed
  // message shows a Retry send button on each, but clicking any of them
  // does the exact same thing.
  const retrySend = useCallback(
    async (conversationId: string, messageId: string) => {
      setRetryingMessageIds((prev) => new Set(prev).add(messageId));
      try {
        const res = await fetch(
          `/api/admin/conversations/${encodeURIComponent(conversationId)}/actions/retry-send`,
          { method: "POST", headers: { "X-API-Key": apiKey } },
        );
        const json = await res.json();
        if (!res.ok) {
          showNotification(typeof json.error === "string" ? json.error : "Retry failed", "error");
          return;
        }
        if (json.ok) {
          showNotification("Message resent successfully.", "success");
        } else {
          showNotification(
            `Retry attempted but failed again: ${json.error ?? "unknown error"}`,
            "error",
          );
        }
        await Promise.all([loadDetailFor(conversationId), loadConversations()]);
      } catch (err) {
        showNotification(err instanceof Error ? err.message : "Unknown error", "error");
      } finally {
        setRetryingMessageIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [apiKey, loadDetailFor, loadConversations, showNotification],
  );

  const retriggerTurn = useCallback(
    async (conversationId: string) => {
      setRetriggeringConversationIds((prev) => new Set(prev).add(conversationId));
      try {
        const res = await fetch(
          `/api/admin/conversations/${encodeURIComponent(conversationId)}/actions/retrigger-turn`,
          { method: "POST", headers: { "X-API-Key": apiKey } },
        );
        const json = await res.json();
        if (!res.ok) {
          showNotification(
            typeof json.error === "string" ? json.error : "Failed to retrigger turn",
            "error",
          );
          return;
        }
        showNotification("Turn retriggered.", "success");
        await Promise.all([loadDetailFor(conversationId), loadConversations()]);
      } catch (err) {
        showNotification(err instanceof Error ? err.message : "Unknown error", "error");
      } finally {
        setRetriggeringConversationIds((prev) => {
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });
      }
    },
    [apiKey, loadDetailFor, loadConversations, showNotification],
  );

  const resolveDecision = useCallback(
    async (decisionId: string, conversationId: string) => {
      setResolvingDecisionIds((prev) => new Set(prev).add(decisionId));
      try {
        const res = await fetch(
          `/api/admin/pending-decisions/${encodeURIComponent(decisionId)}/actions/resolve`,
          { method: "POST", headers: { "X-API-Key": apiKey } },
        );
        const json = await res.json();
        if (!res.ok) {
          showNotification(
            typeof json.error === "string" ? json.error : "Failed to resolve decision",
            "error",
          );
          return;
        }
        showNotification(`Sent: ${json.sentMessage}`, "success");
        await Promise.all([loadDetailFor(conversationId), loadConversations()]);
      } catch (err) {
        showNotification(err instanceof Error ? err.message : "Unknown error", "error");
      } finally {
        setResolvingDecisionIds((prev) => {
          const next = new Set(prev);
          next.delete(decisionId);
          return next;
        });
      }
    },
    [apiKey, loadDetailFor, loadConversations, showNotification],
  );

  const columns = useMemo<ColumnDef<ConversationListItem>[]>(
    () => [
      {
        accessorKey: "phone",
        header: "Phone",
        cell: (info) => info.getValue() as string,
      },
      {
        id: "lastMessage",
        header: "Last message",
        accessorFn: (conversation) => conversation.lastMessage?.content ?? "",
        cell: (info) => {
          const content = info.getValue() as string;
          return content ? truncateMessage(content) : "—";
        },
      },
      {
        id: "lastSeen",
        header: "Last seen",
        accessorFn: (conversation) => conversation.lastMessage?.createdAt ?? conversation.startedAt,
        cell: (info) => formatDate(info.getValue() as string),
      },
      {
        accessorKey: "status",
        header: "Status",
      },
      {
        id: "stuck",
        header: "Stuck",
        enableSorting: false,
        cell: (info) => {
          const conversation = info.row.original;
          return conversation.stuck.any ? (
            <Badge color="red" variant="outline">
              Stuck
            </Badge>
          ) : (
            "—"
          );
        },
      },
    ],
    [],
  );

  const filteredConversations = useMemo(
    () =>
      stuckOnly ? conversations.filter((conversation) => conversation.stuck.any) : conversations,
    [conversations, stuckOnly],
  );

  const table = useReactTable({
    data: filteredConversations,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const rangeStart = filteredCount === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min(filteredCount, (pageIndex + 1) * pageSize);

  // Re-derived from the just-fetched message list rather than the list-level
  // stuck.orphanedInbound summary, so it stays accurate immediately after a
  // retrigger-turn call (before the top-level conversations list has been
  // re-fetched) — "orphaned" reduces to "the conversation's very last
  // message is role: user", same logic getLastOrphanedUserMessage uses
  // server-side.
  const lastDetailMessage = detailMessages[detailMessages.length - 1];
  const showRetrigger = lastDetailMessage?.role === "user";

  return (
    // Fixed-height column shell: everything above the table/detail-panel row
    // is a normal (shrink-to-content) flex item, and that row is the sole
    // `flex: 1` item, so the row — not the page — is what's constrained to
    // the remaining viewport height. Root `overflow: hidden` plus the row's
    // own `minHeight: 0` are both required here: a flex item's default
    // min-height is `auto` (its content size), which lets it grow past its
    // flex-basis and defeats any `overflow: auto` on its descendants.
    <Box
      p="5"
      style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
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

      <Flex justify="between" align="center" mb="5" style={{ flexShrink: 0 }}>
        <Heading size="6">Conversations</Heading>
        <Dialog.Root open={isApiKeyDialogOpen} onOpenChange={handleApiKeyDialogOpenChange}>
          <Dialog.Trigger>
            <Button
              size="1"
              variant={apiKey ? "soft" : "solid"}
              color={apiKey ? "gray" : undefined}
            >
              {apiKey ? "⚙ Change API key" : "Sign in"}
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="420px">
            <Dialog.Title>GCA Admin API Key</Dialog.Title>
            <Box>
              <Text as="label" htmlFor="api-key" size="2" weight="medium">
                GCA Admin API Key
              </Text>
              <Box mt="1">
                <TextField.Root
                  id="api-key"
                  type="password"
                  autoFocus
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder="X-API-Key"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submitApiKey();
                    }
                  }}
                />
              </Box>
            </Box>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button onClick={submitApiKey} disabled={conversationsLoading || !apiKeyDraft.trim()}>
                {conversationsLoading ? "Loading…" : "Load conversations"}
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>

      <Flex align="center" gap="2" mb="4" style={{ flexShrink: 0 }}>
        <Switch checked={stuckOnly} onCheckedChange={setStuckOnly} />
        <Text size="2">Stuck only</Text>
      </Flex>

      {conversationsError && (
        <Text as="p" color="red" mb="3" style={{ flexShrink: 0 }}>
          {conversationsError}
        </Text>
      )}

      {!hasLoaded && !conversationsLoading && (
        <Text color="gray" style={{ flexShrink: 0 }}>
          Click "Sign in" above to enter your API key and load conversations.
        </Text>
      )}
      {hasLoaded && filteredConversations.length === 0 && (
        <Text color="gray" style={{ flexShrink: 0 }}>
          {stuckOnly ? "No stuck conversations." : "No conversations yet."}
        </Text>
      )}
      {filteredConversations.length > 0 && (
        <Text as="p" size="2" color="gray" mb="2" style={{ flexShrink: 0 }}>
          Showing {rangeStart}–{rangeEnd} of {filteredCount} conversations
        </Text>
      )}

      {/* The one `flex: 1` item in the column — occupies exactly the
          viewport space left over after the header/toggle/status text
          above. `minHeight: 0` overrides the flex default of `auto` so this
          row can't grow past that space; `align="stretch"` (Flex's own
          default) makes both children full-height so each one's own
          `overflow: auto` container below is what scrolls, not this row. */}
      <Flex gap="5" style={{ flex: 1, minHeight: 0 }}>
        <Box
          flexGrow="1"
          style={{
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {filteredConversations.length > 0 && (
            <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
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
                      onClick={() => void selectConversation(row.original)}
                      style={{
                        cursor: "pointer",
                        backgroundColor:
                          row.original.id === selectedConversationId
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
            </Box>
          )}
          {filteredConversations.length > 0 && (
            <Flex align="center" gap="3" mt="3" style={{ flexShrink: 0 }}>
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Text size="2" color="gray">
                Page {table.getState().pagination.pageIndex + 1} of{" "}
                {Math.max(table.getPageCount(), 1)}
              </Text>
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </Flex>
          )}
        </Box>

        {selectedConversationId && (
          // Same flex-column + `minHeight: 0` + `overflow: auto` pattern as
          // the table column, one level deeper: the phone-number header is
          // a fixed-size flex item so it stays pinned, and everything below
          // it (messages, pending decisions) is the sole scrollable region.
          <Box
            style={{
              flexShrink: 0,
              width: 420,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Card style={{ flexShrink: 0 }}>
              <Flex justify="between" align="center">
                <Heading size="4">{detailConversation?.phone ?? "Loading…"}</Heading>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  aria-label="Close"
                  onClick={closeConversationDetail}
                >
                  ✕
                </Button>
              </Flex>
            </Card>

            <Box style={{ flex: 1, minHeight: 0, overflow: "auto", marginTop: "var(--space-3)" }}>
              <Flex direction="column" gap="3">
                {detailLoading && <Text color="gray">Loading…</Text>}
                {detailError && <Text color="red">{detailError}</Text>}

                {detailConversation && (
                  <>
                    <Card>
                      <Heading size="3" mb="2">
                        Pending owner decisions
                      </Heading>
                      {/* Once resolved — by any means: the owner actually
                        answered/approved/rejected, the wait timed out, or an
                        operator manually resolved it — this stops being a
                        "pending" decision at all, so it drops out of this
                        list entirely rather than lingering unresolved-looking. */}
                      {detailPendingDecisions.filter((decision) => decision.resolvedAt === null)
                        .length === 0 && (
                        <Text color="gray" size="2">
                          None.
                        </Text>
                      )}
                      <Flex direction="column" gap="2">
                        {detailPendingDecisions
                          .filter((decision) => decision.resolvedAt === null)
                          .map((decision) => (
                            <Box
                              key={decision.id}
                              style={{
                                border: "1px solid var(--gray-a5)",
                                borderRadius: "var(--radius-3)",
                                padding: "8px 10px",
                              }}
                            >
                              <Text as="div" size="2" weight="medium" mb="1">
                                {TOOL_NAME_LABEL[decision.toolName]}
                              </Text>
                              {decision.reason && (
                                <Text as="div" size="2" color="gray" mb="1">
                                  {decision.reason}
                                </Text>
                              )}
                              {/* Status badge lives in this metadata line —
                                  describing the decision itself — rather than
                                  beside the Send now button below, so the two
                                  don't read as a matched pair of controls. */}
                              <Text as="div" size="1" color="gray">
                                Sent {formatDate(decision.sentAt)}
                                {decision.relayedAt &&
                                  ` · Relayed ${formatDate(decision.relayedAt)}`}
                                {decision.stuck && (
                                  <>
                                    {" · "}
                                    <Badge color="red" variant="outline">
                                      Stuck
                                    </Badge>
                                  </>
                                )}
                              </Text>
                              {decision.stuck && (
                                <Box mt="2">
                                  <Button
                                    size="1"
                                    disabled={resolvingDecisionIds.has(decision.id)}
                                    onClick={() =>
                                      void resolveDecision(decision.id, detailConversation.id)
                                    }
                                  >
                                    {resolvingDecisionIds.has(decision.id)
                                      ? "Sending…"
                                      : "Send now"}
                                  </Button>
                                </Box>
                              )}
                            </Box>
                          ))}
                      </Flex>
                    </Card>

                    <Card>
                      <Flex align="baseline" gap="2" mb="2">
                        <Heading size="3">Messages</Heading>
                        <Text size="1" color="gray">
                          (newest first)
                        </Text>
                      </Flex>
                      <Flex direction="column" gap="2">
                        {detailMessages.length === 0 && (
                          <Text color="gray" size="2">
                            No messages yet.
                          </Text>
                        )}
                        {/* Rendered newest-first — detailMessages itself
                            stays chronological (oldest-first) since
                            lastDetailMessage above relies on that order. */}
                        {[...detailMessages].reverse().map((message) => (
                          <Box
                            key={message.id}
                            style={{
                              alignSelf: message.role === "user" ? "flex-start" : "flex-end",
                              backgroundColor:
                                message.role === "user" ? "var(--gray-a3)" : "var(--accent-a4)",
                              borderRadius: "var(--radius-3)",
                              padding: "6px 10px",
                              maxWidth: "90%",
                            }}
                          >
                            {/* Status badges (Not delivered / No reply sent)
                                sit in this metadata line — describing the
                                message itself — rather than beside their
                                action button below, so the two don't read as
                                a matched pair of controls. */}
                            <Text as="div" size="1" color="gray">
                              {message.role === "user" ? "Guest" : "Agent"} ·{" "}
                              {formatDate(message.createdAt)}
                              {message.role === "assistant" &&
                                message.deliveryStatus === "failed" && (
                                  <>
                                    {" · "}
                                    <Badge color="red" variant="outline">
                                      Not delivered
                                    </Badge>
                                  </>
                                )}
                              {message.role === "user" &&
                                showRetrigger &&
                                message.id === lastDetailMessage?.id && (
                                  <>
                                    {" · "}
                                    <Badge color="red" variant="outline">
                                      No reply sent
                                    </Badge>
                                  </>
                                )}
                            </Text>
                            <Text as="div" size="2">
                              {message.content}
                            </Text>
                            {message.role === "assistant" &&
                              message.deliveryStatus === "failed" && (
                                <Box mt="1">
                                  <Button
                                    size="1"
                                    disabled={retryingMessageIds.has(message.id)}
                                    onClick={() =>
                                      void retrySend(detailConversation.id, message.id)
                                    }
                                  >
                                    {retryingMessageIds.has(message.id)
                                      ? "Retrying…"
                                      : "Retry send"}
                                  </Button>
                                </Box>
                              )}
                          </Box>
                        ))}
                        {showRetrigger && (
                          <Flex justify="end" mt="1">
                            <Button
                              size="1"
                              disabled={retriggeringConversationIds.has(detailConversation.id)}
                              onClick={() => void retriggerTurn(detailConversation.id)}
                            >
                              {retriggeringConversationIds.has(detailConversation.id)
                                ? "Retriggering…"
                                : "Retrigger turn"}
                            </Button>
                          </Flex>
                        )}
                      </Flex>
                    </Card>
                  </>
                )}
              </Flex>
            </Box>
          </Box>
        )}
      </Flex>
    </Box>
  );
}
