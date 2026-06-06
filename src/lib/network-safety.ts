export function isNonPublicIp(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, "").split("%", 1)[0].toLowerCase();
  const ipv4 = parseIpv4(address);
  if (ipv4) return isNonPublicIpv4(ipv4);
  if (!address.includes(":")) return false;

  const ipv6 = parseIpv6(address);
  if (!ipv6) return true;

  const mappedIpv4 = getEmbeddedIpv4(ipv6);
  if (mappedIpv4) return isNonPublicIpv4(mappedIpv4);

  // Publicly routable IPv6 is currently allocated from 2000::/3.
  if ((ipv6[0] & 0xe000) !== 0x2000) return true;

  // Documentation, benchmarking, ORCHID and other non-production ranges.
  if (ipv6[0] === 0x2001) {
    if (ipv6[1] <= 0x01ff || ipv6[1] === 0x0db8) return true;
  }
  if (ipv6[0] === 0x2002) return true;
  return false;
}

function isNonPublicIpv4([a, b, c]: [number, number, number, number]): boolean {
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part) => part > 255)) return null;
  return numbers as [number, number, number, number];
}

function parseIpv6(value: string): number[] | null {
  let normalized = value;
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const ipv4 = parseIpv4(dottedTail);
    if (!ipv4) return null;
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    normalized = normalized.slice(0, -dottedTail.length) + `${high}:${low}`;
  }

  if ((normalized.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = normalized.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (!normalized.includes("::") && left.length !== 8) return null;
  if (left.length + right.length > 7) return null;

  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return groups.map((part) => Number.parseInt(part, 16));
}

function getEmbeddedIpv4(ipv6: number[]): [number, number, number, number] | null {
  const mapped = ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff;
  const compatible = ipv6.slice(0, 6).every((part) => part === 0);
  if (!mapped && !compatible) return null;

  return [
    ipv6[6] >> 8,
    ipv6[6] & 0xff,
    ipv6[7] >> 8,
    ipv6[7] & 0xff,
  ];
}
