export default defineContentScript({
  matches: ['https://*.alibaba.com/*'],
  runAt: 'document_start',
  main() {
    console.debug('[oneVegetable] content bridge ready');
  }
});
