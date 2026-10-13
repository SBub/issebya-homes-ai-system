import { LOCKIN_OPT_IN_COPY, LOCKIN_PRIVACY_LINK_LABEL } from "@/lib/lockin-waitlist/copy";

type ConsentFieldProps = {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
  disabled: boolean;
};

// The required consent checkbox both forms share. Controlled, so the parent
// can keep its submit disabled until it is ticked. Starts unticked: a
// marketing opt-in must be affirmative.
export function ConsentField({ id, checked, onCheckedChange, error, disabled }: ConsentFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3 text-sm leading-relaxed">
        <input
          id={id}
          name="marketingOptIn"
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 h-4 w-4 shrink-0 accent-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        />
        <label htmlFor={id}>
          {LOCKIN_OPT_IN_COPY}{" "}
          <a
            href="/privacy-policy"
            className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            {LOCKIN_PRIVACY_LINK_LABEL}
          </a>
        </label>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
