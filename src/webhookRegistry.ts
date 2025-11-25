import { createYookassaWebhookValidator } from './yookassaValidator.js';
import type { WebhookHandler, WebhookValidator } from './webhookTypes.js';

export type WebhookRoute = {
  path: string;
  validator: WebhookValidator;
  handler?: WebhookHandler;
};

export const loadWebhookRoutes = async (yookassaHandler: WebhookHandler): Promise<WebhookRoute[]> => {
  const yookassaValidator = await createYookassaWebhookValidator();
  return [
    { path: '/payment/yookassa', validator: yookassaValidator, handler: yookassaHandler },
    { path: '/payment/yookassa_test', validator: yookassaValidator, handler: yookassaHandler }
  ];
};
