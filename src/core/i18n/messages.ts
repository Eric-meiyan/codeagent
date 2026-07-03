import { m as generatedMessages } from '@/paraglide/messages.js';

type MessageFunction = (...args: unknown[]) => string;
type MessageMap = Record<string, MessageFunction>;
type MessageAccessor = Record<string, MessageFunction | MessageAccessor>;

const rawMessages = generatedMessages as MessageMap;
const namespaceCache = new Map<string, MessageAccessor>();

function getMessage(path: string): MessageFunction | undefined {
  return rawMessages[path] ?? rawMessages[path.replaceAll('.', '_')];
}

function createNamespace(path: string): MessageAccessor {
  const cached = namespaceCache.get(path);
  if (cached) {
    return cached;
  }

  const namespace = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') {
          return undefined;
        }

        if (
          property === 'then' ||
          property === 'catch' ||
          property === 'finally'
        ) {
          return undefined;
        }

        const nextPath = path ? `${path}.${property}` : property;
        const message = getMessage(nextPath);
        if (message) {
          return message;
        }

        return createNamespace(nextPath);
      },
    }
  ) as MessageAccessor;

  namespaceCache.set(path, namespace);
  return namespace;
}

export const m = new Proxy(createNamespace(''), {
  get(target, property, receiver) {
    if (typeof property !== 'string') {
      return Reflect.get(target, property, receiver);
    }

    const direct = getMessage(property);
    if (direct !== undefined) {
      return direct;
    }

    return Reflect.get(target, property, receiver);
  },
}) as MessageAccessor;
