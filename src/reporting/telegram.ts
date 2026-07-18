export interface DeliveryResult {
  delivered: boolean;
  detail: string;
}

/** Sends `text` to `chatId`, retrying once on failure. Never throws — caller
 * must persist a fallback record when `delivered` is false (see storage/persistence). */
export async function sendReport(
  botToken: string,
  chatId: string,
  text: string,
): Promise<DeliveryResult> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      const body = await response.json();
      if (response.status === 200 && body?.ok === true) {
        return { delivered: true, detail: "delivered" };
      }
      lastError = `status=${response.status} body=${JSON.stringify(body)}`;
    } catch (error) {
      lastError = `attempt ${attempt}: ${String(error)}`;
    }
  }
  return { delivered: false, detail: lastError };
}
