interface InfoSectionProps {
  id: string;
  title: string;
  titleClassName?: string;
  children: React.ReactNode;
}

export function InfoSection({
  id,
  title,
  titleClassName = "text-header",
  children,
}: InfoSectionProps) {
  return (
    <section id={id} className="scroll-mt-48">
      <h2 className={`text-4xl font-bold mb-6 ${titleClassName}`}>{title}</h2>
      <div className="space-y-4 text-secondary">{children}</div>
    </section>
  );
}
