import { headers } from "next/headers";
import ToolsHomeClient from "./_components/tools-home-client";

export const dynamic = "force-dynamic";

export default async function ToolsHome() {
  const requestHeaders = await headers();
  const clientIp = getClientIp(requestHeaders);
  const isAllowedIp = clientIp ? getAllowedIps().includes(normalizeIp(clientIp)) : false;

  return <ToolsHomeClient initialUnlocked={isAllowedIp} clientIp={clientIp} />;
}

function getClientIp(requestHeaders: Headers) {
  const candidates = [
    requestHeaders.get("cf-connecting-ip"),
    requestHeaders.get("cf-connecting-ipv6"),
    requestHeaders.get("true-client-ip"),
    requestHeaders.get("x-real-ip"),
    requestHeaders.get("x-forwarded-for")?.split(",")[0],
    requestHeaders.get("forwarded")?.match(/for="?([^;,"]+)/i)?.[1],
  ];

  return candidates.map((value) => normalizeIp(value ?? "")).find(Boolean) ?? "";
}

function getAllowedIps() {
  return (process.env.TOOLS_ALLOWLIST_IPS ?? "")
    .split(/[\s,]+/)
    .map(normalizeIp)
    .filter(Boolean);
}

function normalizeIp(value: string) {
  return value
    .trim()
    .replace(/^TOOLS_ALLOWLIST_IPS=/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/i, "");
}
