interface CalloutProps {
  children: React.ReactNode;
}

export function Callout({ children }: CalloutProps) {
  return <div className="border border-dashed p-4 text-sm bg-white">{children}</div>;
}
