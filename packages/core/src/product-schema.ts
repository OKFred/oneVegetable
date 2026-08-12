export type ProductSchemaFieldType =
  'input' | 'multiInput' | 'singleCheck' | 'multiCheck' | 'complex' | 'multiComplex' | 'label';

export interface ProductSchemaOption {
  value: string;
  label: string;
  attributes: Record<string, string>;
}

export interface ProductSchemaRule {
  name: string;
  value: string;
}

export interface ProductSchemaField {
  key: string;
  id: string;
  name: string;
  type: ProductSchemaFieldType;
  value: string | string[];
  attributes: Record<string, string>;
  options: ProductSchemaOption[];
  rules: ProductSchemaRule[];
  children: ProductSchemaField[];
  instances: ProductSchemaField[][];
}

export interface ProductSchemaModel {
  sourceXml: string;
  fields: ProductSchemaField[];
  warnings: string[];
}

export interface ProductSchemaFieldIssue {
  fieldKey: string;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

const FIELD_TYPES = new Set<ProductSchemaFieldType>([
  'input',
  'multiInput',
  'singleCheck',
  'multiCheck',
  'complex',
  'multiComplex',
  'label'
]);

const LOCAL_RULES = new Set([
  'requiredRule',
  'disableRule',
  'minValueRule',
  'maxValueRule',
  'minLengthRule',
  'maxLengthRule',
  'minDecimalDigitsRule',
  'maxDecimalDigitsRule',
  'regexRule',
  'minInputNumRule',
  'maxInputNumRule',
  'tipRule',
  'devTipRule',
  'valueTypeRule',
  'valueAttributeRule'
]);

export function parseProductSchemaXml(xml: string): ProductSchemaModel {
  const document = parseXml(xml);
  const parserError = document.querySelector('parsererror');
  if (parserError) throw new Error(`商品 Schema XML 无法解析：${parserError.textContent}`);
  const warnings: string[] = [];
  const root = document.documentElement;
  return {
    sourceXml: xml,
    fields: directChildren(root, 'field').map((field, index) =>
      parseField(field, `field:${index}`, warnings)
    ),
    warnings
  };
}

export function serializeProductSchemaXml(model: ProductSchemaModel): string {
  const document = parseXml(model.sourceXml);
  const root = document.documentElement;
  const targetFields = directChildren(root, 'field');
  model.fields.forEach((field, index) => {
    const target = targetFields[index];
    if (target) updateField(document, target, field);
  });
  return new XMLSerializer().serializeToString(document);
}

export function validateProductSchemaModel(model: ProductSchemaModel): ProductSchemaFieldIssue[] {
  const issues: ProductSchemaFieldIssue[] = [];
  for (const field of model.fields) validateField(field, issues);
  return issues;
}

export function cloneProductSchemaInstance(field: ProductSchemaField): ProductSchemaField[] {
  const template = field.instances[0] ?? field.children;
  return template.map((child, index) => resetField(child, `${field.key}:instance:new:${index}`));
}

function parseField(element: Element, key: string, warnings: string[]): ProductSchemaField {
  const rawType = element.getAttribute('type') ?? 'label';
  const type = FIELD_TYPES.has(rawType as ProductSchemaFieldType)
    ? (rawType as ProductSchemaFieldType)
    : 'label';
  if (!FIELD_TYPES.has(rawType as ProductSchemaFieldType)) {
    warnings.push(`${element.getAttribute('id') ?? key} 使用未知字段类型 ${rawType}，按只读标签处理`);
  }
  const rules = directChildren(firstDirectChild(element, 'rules'), 'rule').map((rule) => ({
    name: rule.getAttribute('name') ?? '',
    value: rule.getAttribute('value') ?? rule.textContent
  }));
  for (const rule of rules) {
    if (!LOCAL_RULES.has(rule.name)) {
      warnings.push(`${element.getAttribute('id') ?? key} 的 ${rule.name} 需由 Alibaba 服务端校验`);
    }
  }
  const values = directChildren(firstDirectChild(element, 'values'), 'value').map(
    (value) => value.textContent
  );
  const options = directChildren(firstDirectChild(element, 'options'), 'option').map((option) => ({
    value: option.getAttribute('value') ?? option.textContent,
    label: option.getAttribute('displayName') ?? option.textContent,
    attributes: attributesOf(option)
  }));
  const complexValues = directChildren(firstDirectChild(element, 'complex-values'), 'complex-value');
  const instances = complexValues.map((complex, instanceIndex) =>
    directChildren(complex, 'field').map((child, childIndex) =>
      parseField(child, `${key}:instance:${instanceIndex}:field:${childIndex}`, warnings)
    )
  );
  const templateFields = directChildren(element, 'field').map((child, childIndex) =>
    parseField(child, `${key}:template:${childIndex}`, warnings)
  );
  return {
    key,
    id: element.getAttribute('id') ?? key,
    name: element.getAttribute('name') ?? element.getAttribute('id') ?? key,
    type,
    value: type === 'multiInput' || type === 'multiCheck' ? values : (values[0] ?? ''),
    attributes: attributesOf(element),
    options,
    rules,
    children: templateFields.length > 0 ? templateFields : (instances[0] ?? []),
    instances
  };
}

function validateField(field: ProductSchemaField, issues: ProductSchemaFieldIssue[]): void {
  const values = Array.isArray(field.value) ? field.value : [field.value];
  const nonEmpty = values.filter((value) => value.trim() !== '');
  for (const rule of field.rules) {
    if (!LOCAL_RULES.has(rule.name)) {
      issues.push({
        fieldKey: field.key,
        severity: 'warning',
        rule: rule.name,
        message: `${rule.name} 无法在本地安全计算，将由 Alibaba 提交接口最终校验`
      });
      continue;
    }
    const numericRule = Number(rule.value);
    if (rule.name === 'requiredRule' && isTruthy(rule.value) && nonEmpty.length === 0) {
      pushError(issues, field, rule.name, `${field.name} 为必填项`);
    }
    if (rule.name === 'minInputNumRule' && nonEmpty.length < numericRule) {
      pushError(issues, field, rule.name, `${field.name} 至少填写 ${numericRule} 项`);
    }
    if (rule.name === 'maxInputNumRule' && nonEmpty.length > numericRule) {
      pushError(issues, field, rule.name, `${field.name} 最多填写 ${numericRule} 项`);
    }
    for (const value of nonEmpty) validateScalarRule(field, rule, value, issues);
  }
  for (const child of field.children) validateField(child, issues);
  for (const instance of field.instances) for (const child of instance) validateField(child, issues);
}

function validateScalarRule(
  field: ProductSchemaField,
  rule: ProductSchemaRule,
  value: string,
  issues: ProductSchemaFieldIssue[]
): void {
  const limit = Number(rule.value);
  if (rule.name === 'minLengthRule' && value.length < limit) {
    pushError(issues, field, rule.name, `${field.name} 长度不能小于 ${limit}`);
  }
  if (rule.name === 'maxLengthRule' && value.length > limit) {
    pushError(issues, field, rule.name, `${field.name} 长度不能大于 ${limit}`);
  }
  const numeric = Number(value);
  if (rule.name === 'minValueRule' && Number.isFinite(numeric) && numeric < limit) {
    pushError(issues, field, rule.name, `${field.name} 不能小于 ${limit}`);
  }
  if (rule.name === 'maxValueRule' && Number.isFinite(numeric) && numeric > limit) {
    pushError(issues, field, rule.name, `${field.name} 不能大于 ${limit}`);
  }
  const decimalDigits = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  if (rule.name === 'minDecimalDigitsRule' && decimalDigits < limit) {
    pushError(issues, field, rule.name, `${field.name} 小数位不能少于 ${limit}`);
  }
  if (rule.name === 'maxDecimalDigitsRule' && decimalDigits > limit) {
    pushError(issues, field, rule.name, `${field.name} 小数位不能多于 ${limit}`);
  }
  if (rule.name === 'regexRule') {
    try {
      if (!new RegExp(rule.value).test(value)) {
        pushError(issues, field, rule.name, `${field.name} 格式不正确`);
      }
    } catch {
      issues.push({
        fieldKey: field.key,
        severity: 'warning',
        rule: rule.name,
        message: `${field.name} 的正则规则无效，交由服务端校验`
      });
    }
  }
}

function updateField(document: XMLDocument, target: Element, field: ProductSchemaField): void {
  if (field.type !== 'complex' && field.type !== 'multiComplex' && field.type !== 'label') {
    let valuesElement = firstDirectChild(target, 'values');
    if (!valuesElement) {
      valuesElement = document.createElement('values');
      target.append(valuesElement);
    }
    for (const value of directChildren(valuesElement, 'value')) value.remove();
    const values = Array.isArray(field.value) ? field.value : [field.value];
    for (const value of values) {
      const node = document.createElement('value');
      node.textContent = value;
      valuesElement.append(node);
    }
  }
  if (field.type === 'complex' || field.type === 'multiComplex') {
    updateComplexField(document, target, field);
  }
}

function updateComplexField(document: XMLDocument, target: Element, field: ProductSchemaField): void {
  let container = firstDirectChild(target, 'complex-values');
  if (!container) {
    container = document.createElement('complex-values');
    target.append(container);
  }
  const original = directChildren(container, 'complex-value');
  const template = original[0]?.cloneNode(true) as Element | undefined;
  const instances = field.type === 'complex' ? [field.instances[0] ?? field.children] : field.instances;
  for (const value of original) value.remove();
  for (const instance of instances) {
    const complexValue = template?.cloneNode(true) as Element | undefined;
    const targetValue = complexValue ?? document.createElement('complex-value');
    const targetFields = directChildren(targetValue, 'field');
    instance.forEach((child, index) => {
      let targetChild = targetFields[index];
      if (!targetChild) {
        targetChild = document.createElement('field');
        targetChild.setAttribute('id', child.id);
        targetChild.setAttribute('name', child.name);
        targetChild.setAttribute('type', child.type);
        targetValue.append(targetChild);
      }
      updateField(document, targetChild, child);
    });
    container.append(targetValue);
  }
}

function resetField(field: ProductSchemaField, key: string): ProductSchemaField {
  return {
    ...structuredClone(field),
    key,
    value: Array.isArray(field.value) ? [] : '',
    children: field.children.map((child, index) => resetField(child, `${key}:child:${index}`)),
    instances: []
  };
}

function parseXml(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function directChildren(element: Element | null, name: string): Element[] {
  if (!element) return [];
  return Array.from(element.children).filter((child) => child.localName === name);
}

function firstDirectChild(element: Element, name: string): Element | null {
  return directChildren(element, name)[0] ?? null;
}

function attributesOf(element: Element): Record<string, string> {
  return Object.fromEntries(
    Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])
  );
}

function isTruthy(value: string): boolean {
  return value === 'true' || value === '1';
}

function pushError(
  issues: ProductSchemaFieldIssue[],
  field: ProductSchemaField,
  rule: string,
  message: string
): void {
  issues.push({ fieldKey: field.key, severity: 'error', rule, message });
}
