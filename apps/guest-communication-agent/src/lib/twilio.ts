import crypto from "node:crypto";

// Twilio's request-signing scheme: base64(HMAC-SHA1(authToken, url + sorted
// form-param "key+value" pairs)) — see
// https://www.twilio.com/docs/usage/webhooks/webhooks-security.
// `url` must be the exact URL Twilio signed against, not this process's own
// idea of its address.
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}
