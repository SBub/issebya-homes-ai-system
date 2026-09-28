import Link from "next/link";

// The one block every unsubscribe outcome renders; the pages differ only in
// the copy they pass.
export function UnsubscribeMessage({ copy }: { copy: string }) {
  return (
    <article className="p-4 md:p-12">
      <div className="bg-shop-card text-foreground p-4 md:p-8 flex flex-col gap-6">
        <p className="text-sm leading-relaxed max-w-[65ch]">{copy}</p>
        <Link href="/shop" className="self-start text-sm underline">
          Back to the shop
        </Link>
      </div>
    </article>
  );
}
