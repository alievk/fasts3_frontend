export const normalizeHash = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
};

export const extractHashFromMagnet = (magnet: string | null | undefined): string | null => {
  if (!magnet) {
    return null;
  }
  const match = magnet.match(/xt=urn:btih:([^&]+)/i);
  if (!match || !match[1]) {
    return null;
  }
  return normalizeHash(match[1]);
};

