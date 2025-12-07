import type { PaymentClient, PaymentLink } from './types.js';

type WataLinkPayload = {
  type?: 'OneTime' | 'ManyTime';
  amount: number;
  currency: string;
  description: string;
  orderId: string;
  successRedirectUrl: string;
  failRedirectUrl: string;
  expirationDateTime?: string;
};

type WataResponse = Record<string, unknown>;

const toStringField = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return null;
};

const pickResponseObject = (input: unknown): Record<string, unknown> | null => {
  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return null;
};

const extractLink = (data: WataResponse): PaymentLink => {
  const container = pickResponseObject(data.data) ?? data;
  const id =
    toStringField(
      container.id,
      container.linkId,
      container.link_id,
      container.orderId,
      container.order_id
    ) ?? null;
  const confirmationUrl =
    toStringField(
      container.url,
      container.link,
      container.linkUrl,
      container.link_url,
      container.paymentUrl,
      container.payment_url,
      container.redirectUrl,
      container.redirect_url,
      container.confirmationUrl,
      container.confirmation_url
    ) ?? null;
  if (!id || !confirmationUrl) {
    throw new Error('WATA response is missing link id or url');
  }
  return { id, confirmationUrl };
};

export class WataClient implements PaymentClient {
  constructor(
    private readonly accessToken: string,
    private readonly apiBase: string
  ) {}

  async createPayment(input: {
    amount: number;
    description: string;
    returnUrl: string;
    internalOrderId: number;
  }): Promise<PaymentLink> {
    const payload: WataLinkPayload = {
      amount: input.amount,
      currency: 'RUB',
      description: input.description,
      orderId: String(input.internalOrderId),
      successRedirectUrl: input.returnUrl,
      failRedirectUrl: input.returnUrl
    };
    const response = await fetch(`${this.apiBase}/links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || response.statusText);
    }
    let data: WataResponse;
    try {
      data = text ? (JSON.parse(text) as WataResponse) : {};
    } catch {
      throw new Error('Failed to parse WATA response');
    }
    return extractLink(data);
  }
}
