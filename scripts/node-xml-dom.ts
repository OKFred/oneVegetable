import { DOMParser as LinkedomDOMParser } from 'linkedom';

export function installNodeXmlDomGlobals(): () => void {
  const parserDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  const serializerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLSerializer');

  if (typeof globalThis.DOMParser === 'undefined') {
    Object.defineProperty(globalThis, 'DOMParser', {
      configurable: true,
      value: LinkedomDOMParser,
      writable: true
    });
  }
  if (typeof globalThis.XMLSerializer === 'undefined') {
    Object.defineProperty(globalThis, 'XMLSerializer', {
      configurable: true,
      value: NodeXmlSerializer,
      writable: true
    });
  }

  return () => {
    restoreGlobal('DOMParser', parserDescriptor);
    restoreGlobal('XMLSerializer', serializerDescriptor);
  };
}

class NodeXmlSerializer {
  serializeToString(node: Node): string {
    return (node as unknown as { toString(): string }).toString();
  }
}

function restoreGlobal(
  name: 'DOMParser' | 'XMLSerializer',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, name);
}
