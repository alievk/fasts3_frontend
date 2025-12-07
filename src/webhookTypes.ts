export type WebhookContext = {
  ip: string | undefined;
  path: string;
  body: unknown;
  headers: Record<string, unknown>;
  rawBody?: string;
};

export type WebhookValidator = {
  validate: (context: WebhookContext) => Promise<boolean> | boolean;
};

export type WebhookResponse = {
  status?: number;
  body?: unknown;
};

export type WebhookHandler = (context: WebhookContext) => Promise<WebhookResponse | void> | WebhookResponse | void;
