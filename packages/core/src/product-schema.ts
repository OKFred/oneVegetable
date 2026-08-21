export type ProductSchemaFieldType =
  'input' | 'multiInput' | 'singleCheck' | 'multiCheck' | 'complex' | 'multiComplex' | 'label';

export interface ProductSchemaOption {
  value: string;
  label: string;
  attributes: Record<string, string>;
}

export interface ProductSchemaValue {
  text: string;
  attributes: Record<string, string>;
  metadata: ProductSchemaValueMetadata;
}

export interface ProductSchemaValueMetadata {
  fileName?: string;
  groupId?: string;
  width?: string;
  height?: string;
  fileSize?: string;
  referenceCount?: string;
  modifiedAt?: string;
}

export type ProductSchemaValueLayout = 'direct-value' | 'wrapped-values' | 'none';
export type ProductSchemaComplexLayout =
  'direct-complex-value' | 'wrapped-complex-values' | 'repeated-complex-values' | 'none';

export interface ProductSchemaInstance {
  key: string;
  sourcePath: string | null;
  sourceIndex: number | null;
  fields: ProductSchemaField[];
}

export interface ProductSchemaDependExpression {
  fieldId: string;
  value: string;
  symbol: string;
}

export interface ProductSchemaDependGroup {
  operator: 'and' | 'or';
  expressions: ProductSchemaDependExpression[];
}

export interface ProductSchemaRule {
  name: string;
  value: string;
  attributes: Record<string, string>;
  dependGroups: ProductSchemaDependGroup[];
}

export interface ProductSchemaField {
  key: string;
  sourcePath: string;
  sourceIndex: number;
  id: string;
  name: string;
  type: ProductSchemaFieldType;
  values: ProductSchemaValue[];
  attributes: Record<string, string>;
  options: ProductSchemaOption[];
  rules: ProductSchemaRule[];
  children: ProductSchemaField[];
  instances: ProductSchemaInstance[];
  valueLayout: ProductSchemaValueLayout;
  complexLayout: ProductSchemaComplexLayout;
}

export interface ProductSchemaModel {
  sourceXml: string;
  fields: ProductSchemaField[];
  warnings: string[];
  touchedFieldKeys: string[];
}

export interface ProductSchemaFieldIssue {
  fieldKey: string;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

export interface ProductSchemaSerializationInspection {
  xml: string;
  noOp: boolean;
  changedFieldKeys: string[];
  structuralDiffs: string[];
  safe: boolean;
}

export class ProductSchemaSerializationError extends Error {
  readonly inspection: ProductSchemaSerializationInspection;

  constructor(inspection: ProductSchemaSerializationInspection) {
    super(`商品 Schema XML 存在结构异常：${inspection.structuralDiffs.join('；')}`);
    this.name = 'ProductSchemaSerializationError';
    this.inspection = inspection;
  }
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
  'readOnlyRule',
  'minValueRule',
  'maxValueRule',
  'minLengthRule',
  'maxLengthRule',
  'minDecimalDigitsRule',
  'maxDecimalDigitsRule',
  'regexRule',
  'regxRule',
  'minInputNumRule',
  'maxInputNumRule',
  'tipRule',
  'devTipRule',
  'valueTypeRule',
  'valueAttributeRule',
  'minTargetSizeRule',
  'maxTargetSizeRule',
  'minImageSizeRule',
  'maxImageSizeRule'
]);

const INHERITED_RULES = new Set(['regexRule', 'regxRule']);
const NON_VALIDATING_RULES = new Set([
  'disableRule',
  'readOnlyRule',
  'tipRule',
  'devTipRule',
  'valueAttributeRule',
  'minTargetSizeRule',
  'maxTargetSizeRule',
  'minImageSizeRule',
  'maxImageSizeRule'
]);

const VALUE_METADATA_ATTRIBUTES = new Set([
  'fileName',
  'groupId',
  'width',
  'height',
  'fileSize',
  'referenceCount',
  'modifiedAt'
]);

export function parseProductSchemaXml(xml: string): ProductSchemaModel {
  const document = parseXml(xml);
  const parserError = document.querySelector('parsererror');
  if (parserError) throw new Error(`商品 Schema XML 无法解析：${parserError.textContent}`);
  const warnings: string[] = [];
  const root = document.documentElement;
  return {
    sourceXml: xml,
    fields: schemaFieldElements(root).map((field, index) =>
      parseField(field, `field:${index}`, index, warnings)
    ),
    warnings,
    touchedFieldKeys: []
  };
}

export function serializeProductSchemaXml(model: ProductSchemaModel): string {
  const inspection = inspectProductSchemaSerialization(model);
  if (!inspection.safe) throw new ProductSchemaSerializationError(inspection);
  return inspection.xml;
}

export function inspectProductSchemaSerialization(
  model: ProductSchemaModel
): ProductSchemaSerializationInspection {
  const structuralDiffs: string[] = [];
  let sourceModel: ProductSchemaModel;
  try {
    sourceModel = parseProductSchemaXml(model.sourceXml);
  } catch (error: unknown) {
    return unsafeInspection(model.sourceXml, errorMessage(error));
  }

  if (model.fields.length !== sourceModel.fields.length) {
    structuralDiffs.push('根字段数量发生变化');
  }
  const changedFields = model.fields.filter((field) => {
    const sourceField = sourceModel.fields[field.sourceIndex];
    if (sourceField === undefined) {
      structuralDiffs.push(`${field.key} 无法绑定到源字段`);
      return true;
    }
    if (sourceField.id !== field.id || sourceField.type !== field.type) {
      structuralDiffs.push(`${field.key} 无法绑定到源字段`);
      return true;
    }
    return !fieldSemanticsEqual(field, sourceField);
  });

  if (structuralDiffs.length > 0) {
    return {
      xml: model.sourceXml,
      noOp: false,
      changedFieldKeys: changedFields.map((field) => field.key),
      structuralDiffs: uniqueStrings(structuralDiffs),
      safe: false
    };
  }
  if (changedFields.length === 0) {
    return {
      xml: model.sourceXml,
      noOp: true,
      changedFieldKeys: [],
      structuralDiffs: [],
      safe: true
    };
  }

  const document = parseXml(model.sourceXml);
  const targetFields = schemaFieldElements(document.documentElement);
  for (const field of changedFields) {
    const sourceField = sourceModel.fields[field.sourceIndex];
    const target = targetFields[field.sourceIndex];
    if (!sourceField || !target) {
      structuralDiffs.push(`${field.key} 的源节点不存在`);
      continue;
    }
    updateField(document, target, field, sourceField, structuralDiffs);
  }

  const xml = new XMLSerializer().serializeToString(document);
  try {
    const roundTrip = parseProductSchemaXml(xml);
    if (
      roundTrip.fields.length !== model.fields.length ||
      roundTrip.fields.some((field, index) => {
        const expected = model.fields[index];
        return !expected || !fieldSemanticsEqual(field, expected);
      })
    ) {
      structuralDiffs.push('安全补丁后的字段值无法无损回读');
    }
  } catch (error: unknown) {
    structuralDiffs.push(`安全补丁后的 XML 无法解析：${errorMessage(error)}`);
  }

  return {
    xml,
    noOp: false,
    changedFieldKeys: changedFields.map((field) => field.key),
    structuralDiffs: uniqueStrings(structuralDiffs),
    safe: structuralDiffs.length === 0
  };
}

export function validateProductSchemaModel(model: ProductSchemaModel): ProductSchemaFieldIssue[] {
  const issues: ProductSchemaFieldIssue[] = [];
  const fieldValues = collectFieldValues(model.fields);
  for (const field of model.fields) validateField(field, issues, fieldValues, []);
  return issues;
}

export function cloneProductSchemaInstance(field: ProductSchemaField): ProductSchemaInstance {
  const sequence = nextInstanceSequence(field);
  const key = `${field.key}:instance:new:${sequence}`;
  const template = field.instances[0]?.fields ?? field.children;
  return {
    key,
    sourcePath: null,
    sourceIndex: null,
    fields: template.map((child, index) => resetField(child, `${key}:field:${index}`))
  };
}

export function markProductSchemaFieldTouched(
  model: ProductSchemaModel,
  fieldKey: string
): ProductSchemaModel {
  return model.touchedFieldKeys.includes(fieldKey)
    ? model
    : { ...model, touchedFieldKeys: [...model.touchedFieldKeys, fieldKey] };
}

export function productSchemaFieldText(field: ProductSchemaField): string {
  return field.values[0]?.text ?? '';
}

export function productSchemaFieldTexts(field: ProductSchemaField): string[] {
  return field.values.map((value) => value.text);
}

export function withProductSchemaFieldText(
  field: ProductSchemaField,
  text: string,
  attributes = field.values[0]?.attributes ?? {},
  metadata = field.values[0]?.metadata ?? {}
): ProductSchemaField {
  return { ...field, values: [{ text, attributes: { ...attributes }, metadata: { ...metadata } }] };
}

export function withProductSchemaFieldTexts(field: ProductSchemaField, texts: string[]): ProductSchemaField {
  return {
    ...field,
    values: texts.map((text, index) => ({
      text,
      attributes: { ...(field.values[index]?.attributes ?? {}) },
      metadata: { ...(field.values[index]?.metadata ?? {}) }
    }))
  };
}

export function isProductSchemaHtmlField(field: ProductSchemaField): boolean {
  return (
    field.id === 'superText' ||
    field.rules.some((rule) => rule.name === 'valueTypeRule' && rule.value.toLocaleLowerCase() === 'html')
  );
}

export function isProductSchemaImageField(field: ProductSchemaField): boolean {
  return (
    field.id === 'scImages' ||
    field.id.toLocaleLowerCase().includes('image') ||
    field.values.some((value) => Boolean(value.attributes.fileId ?? value.attributes.img)) ||
    field.rules.some((rule) =>
      ['minTargetSizeRule', 'maxTargetSizeRule', 'minImageSizeRule', 'maxImageSizeRule'].includes(rule.name)
    )
  );
}

export function isProductSchemaFieldReadOnly(field: ProductSchemaField): boolean {
  return hasActiveBooleanRule(field, 'readOnlyRule') || hasActiveBooleanRule(field, 'disableRule');
}

export function isProductSchemaFieldDisabled(field: ProductSchemaField): boolean {
  return hasActiveBooleanRule(field, 'disableRule');
}

function parseField(
  element: Element,
  key: string,
  sourceIndex: number,
  warnings: string[]
): ProductSchemaField {
  const rawType = element.getAttribute('type') ?? 'label';
  const type = FIELD_TYPES.has(rawType as ProductSchemaFieldType)
    ? (rawType as ProductSchemaFieldType)
    : 'label';
  if (!FIELD_TYPES.has(rawType as ProductSchemaFieldType)) {
    warnings.push(`${element.getAttribute('id') ?? key} 使用未知字段类型 ${rawType}，按只读标签处理`);
  }

  const rules = directChildren(firstDirectChild(element, 'rules'), 'rule').map(parseRule);
  for (const rule of rules) {
    if (!LOCAL_RULES.has(rule.name)) {
      warnings.push(`${element.getAttribute('id') ?? key} 的 ${rule.name} 需由 Alibaba 服务端校验`);
    }
  }

  const directValues = directChildren(element, 'value');
  const wrappedValues = directChildren(firstDirectChild(element, 'values'), 'value');
  const values = (directValues.length > 0 ? directValues : wrappedValues).map(parseValue);
  const options = directChildren(firstDirectChild(element, 'options'), 'option').map((option) => ({
    value: option.getAttribute('value') ?? option.textContent,
    label: option.getAttribute('displayName') ?? option.textContent,
    attributes: attributesOf(option)
  }));
  const instanceElements = complexInstanceElements(element);
  const instances = instanceElements.map((complex, instanceIndex): ProductSchemaInstance => ({
    key: `${key}:instance:${instanceIndex}`,
    sourcePath: `${key}:instance:${instanceIndex}`,
    sourceIndex: instanceIndex,
    fields: schemaFieldElements(complex).map((child, childIndex) =>
      parseField(child, `${key}:instance:${instanceIndex}:field:${childIndex}`, childIndex, warnings)
    )
  }));
  const fieldsContainer = firstDirectChild(element, 'fields');
  const templateElements = fieldsContainer
    ? directChildren(fieldsContainer, 'field')
    : directChildren(element, 'field');
  const templateFields = templateElements.map((child, childIndex) =>
    parseField(child, `${key}:template:${childIndex}`, childIndex, warnings)
  );

  return {
    key,
    sourcePath: key,
    sourceIndex,
    id: element.getAttribute('id') ?? key,
    name: element.getAttribute('name') ?? element.getAttribute('id') ?? key,
    type,
    values,
    attributes: attributesOf(element),
    options,
    rules,
    children: templateFields.length > 0 ? templateFields : (instances[0]?.fields ?? []),
    instances,
    valueLayout:
      directValues.length > 0 ? 'direct-value' : wrappedValues.length > 0 ? 'wrapped-values' : 'none',
    complexLayout: complexValueLayout(element)
  };
}

function parseRule(rule: Element): ProductSchemaRule {
  const directGroups = directChildren(rule, 'depend-group');
  const wrappedGroups = directChildren(firstDirectChild(rule, 'depend-groups'), 'depend-group');
  return {
    name: rule.getAttribute('name') ?? '',
    value: rule.getAttribute('value') ?? rule.textContent,
    attributes: attributesOf(rule),
    dependGroups: [...directGroups, ...wrappedGroups].map((group) => ({
      operator: group.getAttribute('operator')?.toLocaleLowerCase() === 'or' ? 'or' : 'and',
      expressions: directChildren(group, 'depend-express').map((expression) => ({
        fieldId: expression.getAttribute('fieldId') ?? '',
        value: expression.getAttribute('value') ?? '',
        symbol: expression.getAttribute('symbol') ?? '='
      }))
    }))
  };
}

function parseValue(value: Element): ProductSchemaValue {
  const attributes: Record<string, string> = {};
  const metadata: ProductSchemaValueMetadata = {};
  for (const [name, attributeValue] of Object.entries(attributesOf(value))) {
    if (VALUE_METADATA_ATTRIBUTES.has(name)) {
      metadata[name as keyof ProductSchemaValueMetadata] = attributeValue;
    } else {
      attributes[name] = attributeValue;
    }
  }
  return { text: value.textContent, attributes, metadata };
}

function validateField(
  field: ProductSchemaField,
  issues: ProductSchemaFieldIssue[],
  fieldValues: ReadonlyMap<string, string[]>,
  inheritedRules: ProductSchemaRule[]
): void {
  const rules = [...inheritedRules, ...field.rules];
  const activeRules = rules.filter((rule) => ruleApplies(rule, fieldValues));
  const disabled = activeRules.some((rule) => rule.name === 'disableRule' && isTruthy(rule.value));
  const values = productSchemaFieldTexts(field);
  const nonEmpty = values.filter((value) => value.trim() !== '');

  if (!disabled) {
    for (const rule of activeRules) {
      if (!LOCAL_RULES.has(rule.name)) {
        issues.push({
          fieldKey: field.key,
          severity: 'warning',
          rule: rule.name,
          message: `${rule.name} 无法在本地安全计算，将由 Alibaba 提交接口最终校验`
        });
        continue;
      }
      if (NON_VALIDATING_RULES.has(rule.name)) continue;
      const numericRule = Number(rule.value);
      if (rule.name === 'requiredRule' && isTruthy(rule.value) && nonEmpty.length === 0) {
        pushError(issues, field, rule.name, `${field.name} 为必填项`);
      }
      if (
        rule.name === 'minInputNumRule' &&
        Number.isFinite(numericRule) &&
        violatesMinimum(nonEmpty.length, numericRule, rule)
      ) {
        pushError(issues, field, rule.name, `${field.name} 至少填写 ${numericRule} 项`);
      }
      if (
        rule.name === 'maxInputNumRule' &&
        Number.isFinite(numericRule) &&
        violatesMaximum(nonEmpty.length, numericRule, rule)
      ) {
        pushError(issues, field, rule.name, `${field.name} 最多填写 ${numericRule} 项`);
      }
      for (const value of nonEmpty) validateScalarRule(field, rule, value, issues);
    }
  }

  const childInheritedRules = activeRules.filter((rule) => INHERITED_RULES.has(rule.name));
  if (field.instances.length === 0) {
    for (const child of field.children) {
      validateField(child, issues, fieldValues, childInheritedRules);
    }
  }
  for (const instance of field.instances) {
    for (const child of instance.fields) validateField(child, issues, fieldValues, childInheritedRules);
  }
}

function validateScalarRule(
  field: ProductSchemaField,
  rule: ProductSchemaRule,
  value: string,
  issues: ProductSchemaFieldIssue[]
): void {
  const limit = Number(rule.value);
  const length =
    rule.attributes.unit?.toLocaleLowerCase() === 'byte'
      ? new TextEncoder().encode(value).byteLength
      : Array.from(value).length;
  if (rule.name === 'minLengthRule' && Number.isFinite(limit) && violatesMinimum(length, limit, rule)) {
    pushError(issues, field, rule.name, `${field.name} 长度不能小于 ${limit}`);
  }
  if (rule.name === 'maxLengthRule' && Number.isFinite(limit) && violatesMaximum(length, limit, rule)) {
    pushError(issues, field, rule.name, `${field.name} 长度不能大于 ${limit}`);
  }
  const numeric = Number(value);
  if (
    rule.name === 'minValueRule' &&
    Number.isFinite(numeric) &&
    Number.isFinite(limit) &&
    violatesMinimum(numeric, limit, rule)
  ) {
    pushError(issues, field, rule.name, `${field.name} 不能小于 ${limit}`);
  }
  if (
    rule.name === 'maxValueRule' &&
    Number.isFinite(numeric) &&
    Number.isFinite(limit) &&
    violatesMaximum(numeric, limit, rule)
  ) {
    pushError(issues, field, rule.name, `${field.name} 不能大于 ${limit}`);
  }
  const decimalDigits = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;
  if (rule.name === 'minDecimalDigitsRule' && decimalDigits < limit) {
    pushError(issues, field, rule.name, `${field.name} 小数位不能少于 ${limit}`);
  }
  if (rule.name === 'maxDecimalDigitsRule' && decimalDigits > limit) {
    pushError(issues, field, rule.name, `${field.name} 小数位不能多于 ${limit}`);
  }
  if (rule.name === 'regexRule' || rule.name === 'regxRule') validateRegexRule(field, rule, value, issues);
  if (rule.name === 'valueTypeRule') validateValueTypeRule(field, rule, value, issues);
}

function validateRegexRule(
  field: ProductSchemaField,
  rule: ProductSchemaRule,
  value: string,
  issues: ProductSchemaFieldIssue[]
): void {
  try {
    const matches = new RegExp(rule.value).test(value);
    const valid = isExclusive(rule) ? !matches : matches;
    if (!valid) pushError(issues, field, rule.name, `${field.name} 格式不正确`);
  } catch {
    issues.push({
      fieldKey: field.key,
      severity: 'warning',
      rule: rule.name,
      message: `${field.name} 的正则规则无效，交由服务端校验`
    });
  }
}

function validateValueTypeRule(
  field: ProductSchemaField,
  rule: ProductSchemaRule,
  value: string,
  issues: ProductSchemaFieldIssue[]
): void {
  const type = rule.value.toLocaleLowerCase();
  let valid = true;
  if (type === 'integer' || type === 'long') valid = /^-?\d+$/.test(value);
  if (type === 'decimal' || type === 'number') valid = /^-?(?:\d+|\d*\.\d+)$/.test(value);
  if (type === 'url') {
    try {
      const url = new URL(value);
      valid = url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      valid = false;
    }
  }
  if (!valid) pushError(issues, field, rule.name, `${field.name} 类型不正确`);
}

function updateField(
  document: XMLDocument,
  target: Element,
  field: ProductSchemaField,
  sourceField: ProductSchemaField,
  structuralDiffs: string[]
): void {
  if (field.type === 'complex' || field.type === 'multiComplex') {
    updateComplexField(document, target, field, sourceField, structuralDiffs);
    return;
  }
  if (!valuesEqual(field.values, sourceField.values)) updateScalarField(document, target, field);
}

function updateScalarField(document: XMLDocument, target: Element, field: ProductSchemaField): void {
  const directValueNodes = directChildren(target, 'value');
  let valuesElement = firstDirectChild(target, 'values');
  const usesWrappedValues = field.valueLayout === 'wrapped-values' || Boolean(valuesElement);
  const parent = usesWrappedValues ? (valuesElement ?? document.createElement('values')) : target;
  if (usesWrappedValues && !valuesElement) {
    valuesElement = parent;
    target.append(valuesElement);
  }
  const existingNodes = usesWrappedValues ? directChildren(parent, 'value') : directValueNodes;
  const template = existingNodes[0];
  const values = valuesForWrite(field);

  values.forEach((value, index) => {
    let node = existingNodes[index];
    if (!node) {
      node = (template?.cloneNode(true) as Element | undefined) ?? document.createElement('value');
      parent.append(node);
    }
    syncAttributes(node, value.attributes);
    setValueText(node, value.text, document);
  });
  for (const node of existingNodes.slice(values.length)) node.remove();
}

function updateComplexField(
  document: XMLDocument,
  target: Element,
  field: ProductSchemaField,
  sourceField: ProductSchemaField,
  structuralDiffs: string[]
): void {
  const sourceNodes = complexInstanceElements(target);
  const retainedSourceIndexes = new Set(
    field.instances.flatMap((instance) => (instance.sourceIndex === null ? [] : [instance.sourceIndex]))
  );

  let previousSourceIndex = -1;
  field.instances.forEach((instance) => {
    if (instance.sourceIndex === null) return;
    if (instance.sourceIndex <= previousSourceIndex) {
      structuralDiffs.push(`${field.key} 的已有复合实例顺序发生变化`);
    }
    previousSourceIndex = instance.sourceIndex;
  });

  field.instances.forEach((instance) => {
    if (instance.sourceIndex === null) {
      const created = createComplexInstanceNode(document, target, field, sourceNodes[0]);
      updateComplexInstance(
        document,
        created,
        instance.fields,
        sourceField.instances[0]?.fields ?? sourceField.children,
        structuralDiffs
      );
      insertComplexInstance(target, created, field.complexLayout);
      return;
    }
    const node = sourceNodes[instance.sourceIndex];
    const sourceInstance = sourceField.instances[instance.sourceIndex];
    if (!node || !sourceInstance) {
      structuralDiffs.push(`${instance.key} 的源实例不存在`);
      return;
    }
    updateComplexInstance(document, node, instance.fields, sourceInstance.fields, structuralDiffs);
  });

  sourceNodes.forEach((node, index) => {
    if (!retainedSourceIndexes.has(index)) node.remove();
  });
}

function updateComplexInstance(
  document: XMLDocument,
  target: Element,
  fields: ProductSchemaField[],
  sourceFields: ProductSchemaField[],
  structuralDiffs: string[]
): void {
  const fieldsParent = firstDirectChild(target, 'fields');
  const targetFields = fieldsParent ? directChildren(fieldsParent, 'field') : directChildren(target, 'field');
  fields.forEach((field, index) => {
    const targetField = targetFields[index];
    const sourceField = sourceFields[index];
    if (!targetField || !sourceField || targetField.getAttribute('id') !== field.id) {
      structuralDiffs.push(`${field.key} 无法绑定到复合实例子字段`);
      return;
    }
    updateField(document, targetField, field, sourceField, structuralDiffs);
  });
}

function createComplexInstanceNode(
  document: XMLDocument,
  target: Element,
  field: ProductSchemaField,
  sourceTemplate: Element | undefined
): Element {
  if (sourceTemplate) return sourceTemplate.cloneNode(true) as Element;
  const nodeName = field.complexLayout === 'repeated-complex-values' ? 'complex-values' : 'complex-value';
  const node = document.createElement(nodeName);
  const fieldTemplate = firstDirectChild(target, 'fields');
  for (const templateField of directChildren(fieldTemplate, 'field')) {
    node.append(templateField.cloneNode(true));
  }
  return node;
}

function insertComplexInstance(target: Element, instance: Element, layout: ProductSchemaComplexLayout): void {
  if (layout === 'wrapped-complex-values') {
    const wrapper = directChildren(target, 'complex-values').find(
      (candidate) => directChildren(candidate, 'complex-value').length > 0
    );
    if (wrapper) {
      wrapper.append(instance);
      return;
    }
  }
  const template = firstDirectChild(target, 'fields');
  target.insertBefore(instance, template);
}

function resetField(field: ProductSchemaField, key: string): ProductSchemaField {
  return {
    ...structuredClone(field),
    key,
    sourcePath: key,
    sourceIndex: -1,
    values: field.values.length > 0 ? [{ text: '', attributes: {}, metadata: {} }] : [],
    children: field.children.map((child, index) => resetField(child, `${key}:child:${index}`)),
    instances: []
  };
}

function nextInstanceSequence(field: ProductSchemaField): number {
  const prefix = `${field.key}:instance:new:`;
  const used = field.instances.flatMap((instance) => {
    if (!instance.key.startsWith(prefix)) return [];
    const sequence = Number(instance.key.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence >= 0 ? [sequence] : [];
  });
  return used.length === 0 ? 0 : Math.max(...used) + 1;
}

function collectFieldValues(fields: ProductSchemaField[]): ReadonlyMap<string, string[]> {
  const result = new Map<string, string[]>();
  const visit = (field: ProductSchemaField): void => {
    const existing = result.get(field.id) ?? [];
    result.set(field.id, [...existing, ...productSchemaFieldTexts(field)]);
    if (field.instances.length === 0) for (const child of field.children) visit(child);
    for (const instance of field.instances) for (const child of instance.fields) visit(child);
  };
  for (const field of fields) visit(field);
  return result;
}

function ruleApplies(rule: ProductSchemaRule, fieldValues: ReadonlyMap<string, string[]>): boolean {
  if (rule.dependGroups.length === 0) return true;
  return rule.dependGroups.every((group) => {
    const results = group.expressions.map((expression) =>
      (fieldValues.get(expression.fieldId) ?? []).some((value) =>
        compareDependency(value, expression.value, expression.symbol)
      )
    );
    return group.operator === 'or' ? results.some(Boolean) : results.every(Boolean);
  });
}

function compareDependency(actual: string, expected: string, symbol: string): boolean {
  if (symbol === '=' || symbol === '==') return actual === expected;
  if (symbol === '!=') return actual !== expected;
  if (symbol === 'in')
    return expected
      .split(',')
      .map((value) => value.trim())
      .includes(actual);
  if (symbol === 'not in' || symbol === 'notIn') {
    return !expected
      .split(',')
      .map((value) => value.trim())
      .includes(actual);
  }
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
  if (symbol === '>') return actualNumber > expectedNumber;
  if (symbol === '>=') return actualNumber >= expectedNumber;
  if (symbol === '<') return actualNumber < expectedNumber;
  if (symbol === '<=') return actualNumber <= expectedNumber;
  return false;
}

function hasActiveBooleanRule(field: ProductSchemaField, ruleName: string): boolean {
  return field.rules.some(
    (rule) => rule.name === ruleName && rule.dependGroups.length === 0 && isTruthy(rule.value)
  );
}

function violatesMinimum(actual: number, limit: number, rule: ProductSchemaRule): boolean {
  return isExclusive(rule) ? actual <= limit : actual < limit;
}

function violatesMaximum(actual: number, limit: number, rule: ProductSchemaRule): boolean {
  return isExclusive(rule) ? actual >= limit : actual > limit;
}

function isExclusive(rule: ProductSchemaRule): boolean {
  const value = rule.attributes.exProperty?.replaceAll(/[-_\s]/g, '').toLocaleLowerCase();
  return value === 'notinclude' || value === 'exclude' || value === 'exclusive';
}

function complexInstanceElements(element: Element): Element[] {
  const directInstances = directChildren(element, 'complex-value');
  if (directInstances.length > 0) return directInstances;
  const plural = directChildren(element, 'complex-values');
  const wrapped = plural.flatMap((container) => directChildren(container, 'complex-value'));
  return wrapped.length > 0
    ? wrapped
    : plural.filter((container) => schemaFieldElements(container).length > 0);
}

function complexValueLayout(element: Element): ProductSchemaComplexLayout {
  if (directChildren(element, 'complex-value').length > 0) return 'direct-complex-value';
  const plural = directChildren(element, 'complex-values');
  if (plural.some((container) => directChildren(container, 'complex-value').length > 0)) {
    return 'wrapped-complex-values';
  }
  if (plural.some((container) => schemaFieldElements(container).length > 0)) {
    return 'repeated-complex-values';
  }
  return 'none';
}

function schemaFieldElements(element: Element): Element[] {
  const fieldsContainer = firstDirectChild(element, 'fields');
  return fieldsContainer ? directChildren(fieldsContainer, 'field') : directChildren(element, 'field');
}

function valuesForWrite(field: ProductSchemaField): ProductSchemaValue[] {
  if (field.values.length > 0) return field.values;
  if (field.type === 'multiInput' || field.type === 'multiCheck') return [];
  return [{ text: '', attributes: {}, metadata: {} }];
}

function fieldSemanticsEqual(left: ProductSchemaField, right: ProductSchemaField): boolean {
  if (left.id !== right.id || left.type !== right.type || !valuesEqual(left.values, right.values))
    return false;
  if (left.instances.length !== right.instances.length) return false;
  return left.instances.every((instance, index) => {
    const other = right.instances[index];
    if (!other) return false;
    return fieldListsEqual(instance.fields, other.fields);
  });
}

function fieldListsEqual(left: ProductSchemaField[], right: ProductSchemaField[]): boolean {
  return (
    left.length === right.length &&
    left.every((field, index) => {
      const other = right[index];
      return other ? fieldSemanticsEqual(field, other) : false;
    })
  );
}

function valuesEqual(left: ProductSchemaValue[], right: ProductSchemaValue[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const other = right[index];
      return other ? value.text === other.text && recordsEqual(value.attributes, other.attributes) : false;
    })
  );
}

function recordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  );
}

function syncAttributes(element: Element, attributes: Record<string, string>): void {
  for (const attribute of Array.from(element.attributes)) {
    if (!(attribute.name in attributes)) element.removeAttribute(attribute.name);
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
}

function setValueText(element: Element, text: string, document: XMLDocument): void {
  const onlyChild = element.childNodes.length === 1 ? element.firstChild : null;
  if (onlyChild?.nodeType === 4) {
    onlyChild.nodeValue = text;
    return;
  }
  element.replaceChildren(document.createTextNode(text));
}

function unsafeInspection(xml: string, message: string): ProductSchemaSerializationInspection {
  return {
    xml,
    noOp: false,
    changedFieldKeys: [],
    structuralDiffs: [message],
    safe: false
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
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
