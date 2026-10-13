// The one block every unsubscribe outcome renders; the pages differ only in
// the copy they pass. No links: the waitlist page has no chrome and nothing
// to link back to while it is unreleased.
export function UnsubscribeMessage({ copy }: { copy: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <p className="max-w-md bg-white p-8 text-center text-base leading-relaxed text-black">
        {copy}
      </p>
    </div>
  );
}
