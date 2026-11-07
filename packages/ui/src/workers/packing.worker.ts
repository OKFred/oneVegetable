import { packCargo, type PackingInput } from '../lib/packing-layout';

globalThis.onmessage = (event: MessageEvent<PackingInput>) => {
  try {
    globalThis.postMessage({ result: packCargo(event.data) });
  } catch (error) {
    globalThis.postMessage({ error: error instanceof Error ? error.message : 'Packing failed' });
  }
};
