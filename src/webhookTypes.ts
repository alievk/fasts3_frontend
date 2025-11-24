export type WebhookContext = {
  ip: string | undefined;
  path: string;
  body: unknown;
  headers: Record<string, unknown>;
};

export type WebhookValidator = {
  validate: (context: WebhookContext) => Promise<boolean> | boolean;
};
