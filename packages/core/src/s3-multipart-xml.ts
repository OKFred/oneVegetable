/** Small, fail-closed parser for bounded S3 control XML; no DTD, entities, or executable content. */
export interface MultipartXmlNode {
  name: string;
  text: string;
  children: MultipartXmlNode[];
}

export function parseMultipartXml(xml: string): MultipartXmlNode {
  if (xml.length > 65_536) invalid();
  const source = xml.replace(/^\uFEFF/u, '').replace(/^\s*<\?xml\s[^?]*\?>/u, '');
  const tokens = source.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/gu) ?? [];
  if (tokens.join('') !== source) invalid();
  const stack: MultipartXmlNode[] = [];
  let root: MultipartXmlNode | undefined;
  let count = 0;
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<')) {
      const current = stack.at(-1);
      if (current) current.text += decodeText(token);
      else if (token.trim()) invalid();
      continue;
    }
    const closing = /^<\/([A-Za-z_][A-Za-z0-9_.-]*)\s*>$/u.exec(token);
    if (closing) {
      if (stack.pop()?.name !== closing[1]) invalid();
      continue;
    }
    const opening =
      /^<([A-Za-z_][A-Za-z0-9_.-]*)(?:\s+xmlns=(?:"https?:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/"|'https?:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/'))?\s*(\/?)>$/u.exec(
        token
      );
    if (!opening?.[1] || stack.length >= 8 || ++count > 200) invalid();
    const node: MultipartXmlNode = { name: opening[1], text: '', children: [] };
    const parent = stack.at(-1);
    if (parent) parent.children.push(node);
    else if (root) invalid();
    else root = node;
    if (opening[2] !== '/') stack.push(node);
  }
  if (!root || stack.length) invalid();
  return root;
}

export function multipartScalar(node: MultipartXmlNode, name: string, required = true): string | null {
  const values = node.children.filter((child) => child.name === name);
  if (!values.length && !required) return null;
  const value = values[0];
  if (values.length !== 1 || !value || value.children.length) invalid();
  return value.text.trim();
}

export function assertMultipartContainer(node: MultipartXmlNode, name: string): void {
  if (node.name !== name || node.text.trim()) invalid();
}

function decodeText(value: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/u.test(value)) invalid();
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/gu, (_all, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity] !== undefined) return named[entity];
    const number = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > 0x10ffff ||
      (number >= 0xd800 && number <= 0xdfff)
    )
      invalid();
    return String.fromCodePoint(number);
  });
}

function invalid(): never {
  throw new Error('S3_MULTIPART_RESPONSE_INVALID');
}
