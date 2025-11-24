import fs from 'node:fs/promises';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import type { WebhookValidator } from './webhookTypes.js';

type AllowedRange = [ipaddr.IPv4 | ipaddr.IPv6, number];

const resolveIpListPath = (): string => {
  const customPath = process.env.YOOKASSA_IPS_PATH;
  if (customPath) {
    return path.resolve(customPath);
  }
  return path.resolve(process.cwd(), 'config', 'yookassa_ips.txt');
};

const parseRange = (value: string): AllowedRange => {
  if (value.includes('/')) {
    const [address, prefix] = ipaddr.parseCIDR(value);
    const normalized = ipaddr.process(address.toString());
    return [normalized, prefix];
  }
  const address = ipaddr.process(value);
  const prefix = address.kind() === 'ipv4' ? 32 : 128;
  return [address, prefix];
};

const loadAllowedRanges = async (filePath: string): Promise<AllowedRange[]> => {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) {
    throw new Error('Allowed IP list is empty');
  }
  return lines.map(parseRange);
};

const makeIsAllowed = (ranges: AllowedRange[]) => (clientIp: string | undefined): boolean => {
  if (!clientIp) {
    return false;
  }
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.process(clientIp);
  } catch {
    return false;
  }
  return ranges.some((range) => parsed.match(range));
};

export type YookassaValidator = {
  isAllowed: (clientIp: string | undefined) => boolean;
};

export const createYookassaValidator = async (): Promise<YookassaValidator> => {
  const ipListPath = resolveIpListPath();
  const ranges = await loadAllowedRanges(ipListPath);
  return { isAllowed: makeIsAllowed(ranges) };
};

export const createYookassaWebhookValidator = async (): Promise<WebhookValidator> => {
  const validator = await createYookassaValidator();
  return {
    validate: ({ ip }) => validator.isAllowed(ip)
  };
};
