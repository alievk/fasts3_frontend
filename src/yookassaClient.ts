import { randomUUID } from 'node:crypto';
import type { PaymentClient, PaymentLink } from './types.js';

type YookassaConfirmation = {
  type?: string;
  confirmation_url?: string;
};

type YookassaPayment = {
  id?: string;
  status?: string;
  confirmation?: YookassaConfirmation;
};

type YookassaError = {
  type?: string;
  id?: string;
  code?: string;
  description?: string;
};

type YookassaResponse = YookassaPayment & { error?: YookassaError };

const formatAmount = (value: number): string => value.toFixed(2);

export class YookassaClient implements PaymentClient {
  private readonly authHeader: string;
  private readonly endpoint: string;

  constructor(private readonly shopId: string, private readonly secretKey: string) {
    const token = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
    this.authHeader = `Basic ${token}`;
    this.endpoint = 'https://api.yookassa.ru/v3/payments';
  }

  async createPayment(input: {
    amount: number;
    description: string;
    returnUrl: string;
    internalOrderId: number;
  }): Promise<PaymentLink> {
    const payload = {
      amount: { value: formatAmount(input.amount), currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: input.returnUrl
      },
      description: input.description,
      metadata: {
        internal_order_id: input.internalOrderId
      }
    };
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        'Idempotence-Key': randomUUID()
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || response.statusText);
    }
    let data: YookassaResponse;
    try {
      data = text ? (JSON.parse(text) as YookassaResponse) : {};
    } catch (error) {
      throw new Error('Failed to parse Yookassa response');
    }
    if (data.error) {
      throw new Error(data.error.description || data.error.code || 'Yookassa error');
    }
    const confirmationUrl = data.confirmation?.confirmation_url;
    if (!data.id || !confirmationUrl) {
      throw new Error('Yookassa response is missing payment id or confirmation_url');
    }
    return { id: data.id, confirmationUrl };
  }
}
