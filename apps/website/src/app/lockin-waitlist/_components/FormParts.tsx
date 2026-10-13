import {
  LOCKIN_EMAIL_LABEL,
  LOCKIN_PENDING_LABEL,
  LOCKIN_SUBMIT_LABEL,
} from "@/lib/lockin-waitlist/copy";

export const INPUT_CLASS =
  "w-full border border-black/60 bg-white px-3 py-3 text-base text-black placeholder:text-black/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black aria-invalid:border-red-700";

export const FOCUS_CLASS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black";

type EmailFieldProps = {
  id: string;
  attempt: number;
  defaultValue: string;
  error?: string;
  disabled: boolean;
};

export function EmailField({ id, attempt, defaultValue, error, disabled }: EmailFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {LOCKIN_EMAIL_LABEL}
      </label>
      <input
        // Re-keyed per attempt: React resets an uncontrolled form when the
        // action starts, so the echoed email re-seeds it after an error.
        key={`email-${attempt}`}
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={defaultValue}
        placeholder="your@email.com"
        className={INPUT_CLASS}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
      />
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// Off-screen and hidden from assistive tech. Humans never fill it; bots that
// fill every field get a silent success.
export function HoneypotField({ id }: { id: string }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label htmlFor={id}>Website</label>
      <input id={id} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}

export function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`min-h-12 w-full bg-black px-6 py-3 text-sm uppercase tracking-[0.2em] text-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 md:w-auto md:self-start ${FOCUS_CLASS}`}
    >
      {pending ? LOCKIN_PENDING_LABEL : LOCKIN_SUBMIT_LABEL}
    </button>
  );
}

export function GeneralError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {message}
    </p>
  );
}
