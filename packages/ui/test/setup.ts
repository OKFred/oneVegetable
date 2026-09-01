if ('navigator' in globalThis) {
  Object.defineProperty(globalThis.navigator, 'languages', {
    configurable: true,
    value: ['zh-CN']
  });
}
