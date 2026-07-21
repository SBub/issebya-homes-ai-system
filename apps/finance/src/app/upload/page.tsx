"use client";

import { type FormEvent, useState } from "react";

export default function UploadPage() {
  const [apiKey, setApiKey] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0) {
      setError("At least 1 CSV file is required");
      return;
    }

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

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
          <label htmlFor="csv-files">
            CSV files (any mix of Airbnb and Booking.com — platform is auto-detected per file, so
            select as many as you need, e.g. one Airbnb export plus several monthly Booking.com
            exports)
          </label>
          <br />
          <input
            id="csv-files"
            type="file"
            accept=".csv"
            multiple
            required
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <ul>
              {files.map((f) => (
                <li key={`${f.name}-${f.size}-${f.lastModified}`}>{f.name}</li>
              ))}
            </ul>
          )}
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
