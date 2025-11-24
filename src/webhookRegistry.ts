import { createYookassaWebhookValidator } from './yookassaValidator.js';
import type { WebhookValidator } from './webhookTypes.js';

export type WebhookRoute = {
  path: string;
  validator: WebhookValidator;
};

export const loadWebhookRoutes = async (): Promise<WebhookRoute[]> => {
  const yookassaValidator = await createYookassaWebhookValidator();
  return [
    { path: '/payment/yookassa', validator: yookassaValidator },
    { path: '/payment/yookassa_test', validator: yookassaValidator }
  ];
};
