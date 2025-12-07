import { createYookassaWebhookValidator } from './yookassaValidator.js';
import { createWataWebhookValidator } from './wataValidator.js';
import type { WebhookHandler, WebhookValidator } from './webhookTypes.js';

export type WebhookRoute = {
  path: string;
  validator: WebhookValidator;
  handler?: WebhookHandler;
};

export const loadWebhookRoutes = async (handlers: {
  yookassa: WebhookHandler;
  wata: WebhookHandler;
}): Promise<WebhookRoute[]> => {
  const yookassaValidator = await createYookassaWebhookValidator();
  const wataValidator = await createWataWebhookValidator();
  return [
    { path: '/payment/yookassa', validator: yookassaValidator, handler: handlers.yookassa },
    { path: '/payment/yookassa_test', validator: yookassaValidator, handler: handlers.yookassa },
    { path: '/payment/wata', validator: wataValidator, handler: handlers.wata },
    { path: '/payment/wata_test', validator: wataValidator, handler: handlers.wata }
  ];
};
