import type { Config, PaymentClient } from './types.js';
import { YookassaClient } from './yookassaClient.js';

export const createPaymentClient = (config: Config): PaymentClient => {
  if (config.paymentProvider === 'yookassa') {
    if (!config.yookassaShopId || !config.yookassaSecretKey) {
      throw new Error('YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY are required for Yookassa provider');
    }
    return new YookassaClient(config.yookassaShopId, config.yookassaSecretKey);
  }
  throw new Error(`Unsupported payment provider: ${config.paymentProvider}`);
};
