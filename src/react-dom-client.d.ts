declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  interface Root {
    render(children: ReactNode): void;
  }

  export function createRoot(container: Element | Document | DocumentFragment): Root;
}
