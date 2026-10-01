import { buildSpanTree, type EndedSpan, type SpanNode } from "@/lib/harness/span-exporter";

/**
 * Renders ended spans as a nested list, by parent id. A disconnected trace
 * shows up as a second root, which is the thing the trace demos make
 * visible. Presentational only, no hooks, so a client demo can render it.
 */
export function SpanTree({ spans }: { spans: EndedSpan[] }) {
  const roots = buildSpanTree(spans);
  if (roots.length === 0) return <p className="mt-1 text-xs">No spans yet.</p>;
  return (
    <ul className="mt-2 font-mono text-xs space-y-1">
      {roots.map((node) => (
        <Node key={node.span.spanId} node={node} depth={0} />
      ))}
    </ul>
  );
}

function Node({ node, depth }: { node: SpanNode; depth: number }) {
  const { span, children } = node;
  const attributes = Object.entries(span.attributes)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return (
    <li>
      {depth === 0 ? "root " : "child "}
      <span className="font-bold">{span.name}</span>
      {span.status === "error" && <span> (error: {span.error})</span>}
      {attributes !== "" && <span className="text-gray-600"> {attributes}</span>}
      {children.length > 0 && (
        <ul className="pl-4 space-y-1">
          {children.map((child) => (
            <Node key={child.span.spanId} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
