import type { Config, PaymentClient } from './types.js';
import { YookassaClient } from './yookassaClient.js';
import { WataClient } from './wataClient.js';

export const createPaymentClient = (config: Config): PaymentClient => {
  if (config.paymentProvider === 'yookassa') {
    if (!config.yookassaShopId || !config.yookassaSecretKey) {
      throw new Error('YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY are required for Yookassa provider');
    }
    return new YookassaClient(config.yookassaShopId, config.yookassaSecretKey, config.yookassaReceiptEmail);
  }
  if (config.paymentProvider === 'wata') {
    if (!config.wataAccessToken) {
      throw new Error('WATA_ACCESS_TOKEN is required for Wata provider');
    }
    const base = config.wataApiBase ?? 'https://api.wata.pro/api/h2h';
    return new WataClient(config.wataAccessToken, base);
  }
  throw new Error(`Unsupported payment provider: ${config.paymentProvider}`);
};
