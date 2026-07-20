import crypto from "node:crypto";

/**
 * Twilio's request-signing scheme: base64(HMAC-SHA1(authToken, url + sorted
 * form-param "key+value" pairs concatenated in place)) — see
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security. Implemented
 * by hand instead of pulling in the `twilio` SDK, to keep this app's
 * dependency footprint as small as every other app in this repo.
 *
 * `url` must be the exact URL Twilio signed against — its own public
 * hostname/path/query string, not whatever this process thinks its address
 * is. Once a real public webhook URL exists, confirm the exact string
 * Twilio uses (via its console or a request log) rather than assuming.
 */
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
