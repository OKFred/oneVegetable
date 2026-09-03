import type { AlibabaCredentialAcquisitionPrerequisiteReason } from './alibaba-credential-acquisition';

/** Runs inside an Alibaba document and returns only a status reason, never registration field values. */
export function inspectAlibabaDeveloperPrerequisiteDocument(): AlibabaCredentialAcquisitionPrerequisiteReason | null {
  const text = document.body.innerText || document.body.textContent || '';
  const forms = [...document.querySelectorAll('.cloud-form')];
  const status =
    forms
      .find((element) => (element.querySelector('.form-label')?.textContent ?? '').trim() === 'App Status')
      ?.querySelector('.form-item')
      ?.textContent.trim() ?? '';
  if (
    status &&
    /under review|pending|offline|disabled|rejected|审核|待处理|未上线|已停用|已驳回/iu.test(status)
  ) {
    return 'application-not-ready';
  }

  const fieldIds = [
    'country',
    'companyName',
    'bizRegistNumber',
    'address',
    'city',
    'province',
    'postcode',
    'bizInfoDocs'
  ];
  const fields = fieldIds.map((id) => document.getElementById(id)).filter(Boolean);
  const registrationFormDetected = fields.length >= 3;
  if (/rejected|review failed|not approved|审核未通过|已驳回|退回修改/iu.test(text)) {
    return 'developer-registration-rejected';
  }
  if (
    registrationFormDetected &&
    (/under review|审核中|审核处理中|2\s*[-–]\s*5\s*working days/iu.test(text) ||
      fields.every((element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
          return element.disabled || (element instanceof HTMLInputElement && element.readOnly);
        }
        return true;
      }))
  ) {
    return 'developer-registration-under-review';
  }
  if (
    registrationFormDetected ||
    /you have not yet registered as a developer|尚未注册.*开发者/iu.test(text)
  ) {
    return 'developer-registration-required';
  }
  if (/no applications?|you have not created an application|暂无应用|还没有应用/iu.test(text)) {
    return 'application-required';
  }
  return null;
}

export function selectAlibabaDeveloperPrerequisite(
  values: readonly unknown[]
): AlibabaCredentialAcquisitionPrerequisiteReason | null {
  for (const reason of [
    'developer-registration-rejected',
    'developer-registration-under-review',
    'developer-registration-required',
    'application-not-ready',
    'application-required'
  ] as const) {
    if (values.includes(reason)) return reason;
  }
  return null;
}
