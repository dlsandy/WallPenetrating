import { fetchRemoteUrlNative } from "./native-bridge.js";
import { parseSubscriptionContent } from "./subscription.js";

export async function fetchAndParseSubscription(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    throw new Error("订阅链接不能为空");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error("订阅链接格式无效");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("仅支持 http/https 订阅链接");
  }

  const res = await fetchRemoteUrlNative(trimmed);
  if (!res?.ok) {
    throw new Error(res?.error || "拉取订阅失败");
  }

  const { uris, errors } = parseSubscriptionContent(res.body);
  return {
    uris,
    errors,
    httpCode: res.httpCode,
    byteLength: res.byteLength,
  };
}
