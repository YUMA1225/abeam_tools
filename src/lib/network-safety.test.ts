import assert from "node:assert/strict";
import test from "node:test";
import { isNonPublicIp } from "./network-safety.ts";

test("blocks private and special IPv4 ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1"]) {
    assert.equal(isNonPublicIp(address), true, address);
  }
  assert.equal(isNonPublicIp("8.8.8.8"), false);
});

test("blocks local, mapped and reserved IPv6 ranges", () => {
  for (const address of ["::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2001:db8::1"]) {
    assert.equal(isNonPublicIp(address), true, address);
  }
  assert.equal(isNonPublicIp("2606:4700:4700::1111"), false);
});
