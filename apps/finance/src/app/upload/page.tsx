"use client";

import { type FormEvent, useState } from "react";

export default function UploadPage() {
  const [apiKey, setApiKey] = useState("");
  const [airbnbFile, setAirbnbFile] = useState<File | null>(null);
  const [bookingComFile, setBookingComFile] = useState<File | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!airbnbFile || !bookingComFile) {
      setError("Both files are required");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("files", airbnbFile);
      formData.append("files", bookingComFile);

      const res = await fetch("/api/finance/import", {
        method: "POST",
        headers: { "X-API-Key": apiKey },
        body: formData,
      });
      const json = await res.json();
      setResult(json);
      if (!res.ok) setError(typeof json.error === "string" ? json.error : "Import failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Finance CSV Import</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="airbnb-file">Airbnb CSV</label>
          <br />
          <input
            id="airbnb-file"
            type="file"
            accept=".csv"
            required
            onChange={(e) => setAirbnbFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="booking-com-file">Booking.com CSV</label>
          <br />
          <input
            id="booking-com-file"
            type="file"
            accept=".csv"
            required
            onChange={(e) => setBookingComFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div style={{ marginBottom: "1rem" }}>
          <label htmlFor="api-key">Finance API Key</label>
          <br />
          <input
            id="api-key"
            type="password"
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Importing…" : "Import"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result !== null && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </main>
  );
}
