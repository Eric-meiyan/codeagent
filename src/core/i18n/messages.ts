import { m as generatedMessages } from '@/paraglide/messages.js';

type MessageFunction = (...args: unknown[]) => string;
type MessageMap = Record<string, MessageFunction>;

const rawMessages = generatedMessages as MessageMap;

export const m = new Proxy(rawMessages, {
  get(target, property, receiver) {
    if (typeof property !== 'string') {
      return Reflect.get(target, property, receiver);
    }

    const direct = target[property];
    if (direct !== undefined) {
      return direct;
    }

    return target[property.replaceAll('.', '_')];
  },
}) as MessageMap;
