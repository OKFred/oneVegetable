import type { AlibabaCredentialAcquisitionPrerequisiteReason } from './alibaba-credential-acquisition';

export type AlibabaDeveloperPageState =
  | {
      kind:
        'ready' | 'registration-approved' | 'navigation-ready' | 'login-required' | 'challenge' | 'waiting';
    }
  | {
      kind: 'prerequisite';
      reasonCode: AlibabaCredentialAcquisitionPrerequisiteReason;
      registration: { missingFieldIds: string[]; agreementAccepted: boolean } | null;
    };

/** Self-contained for executeScript/Playwright serialization. Never returns registration values. */
export function inspectAlibabaDeveloperPageDocument(): AlibabaDeveloperPageState {
  const visible = (element: Element): boolean => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      if (
        current.matches(
          'script,style,noscript,template,[hidden],[aria-hidden="true"],#one-vegetable-alibaba-developer-guide'
        )
      )
        return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')
        return false;
    }
    return true;
  };
  const textOf = (root: Element): string => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent && visible(parent)) parts.push(node.textContent ?? '');
    }
    return parts.join(' ').replace(/\s+/gu, ' ').trim();
  };
  const text = textOf(document.body);
  if (/captcha|验证码|滑块|slide to verify|security verification|二次验证|安全验证/iu.test(text))
    return { kind: 'challenge' };
  if (
    [...document.querySelectorAll('input[type="password"],input[autocomplete="current-password"]')].some(
      visible
    )
  )
    return { kind: 'login-required' };

  const forms = [...document.querySelectorAll('.cloud-form')].filter(visible);
  const status =
    forms
      .find((element) => (element.querySelector('.form-label')?.textContent ?? '').trim() === 'App Status')
      ?.querySelector('.form-item')
      ?.textContent.trim() ?? '';
  if (
    status &&
    /under review|pending|offline|disabled|rejected|审核|待处理|未上线|已停用|已驳回/iu.test(status)
  ) {
    return { kind: 'prerequisite', reasonCode: 'application-not-ready', registration: null };
  }
  if (forms.some((form) => visible(form) && form.querySelector('.form-label'))) return { kind: 'ready' };

  const steps = [...document.querySelectorAll('.next-step-item')].filter(visible);
  const currentStep =
    steps.find((step) =>
      step.matches('.next-step-item-error,[aria-current="step"],.next-step-item-process')
    ) ?? steps.filter((step) => step.matches('.next-step-item-finish')).at(-1);
  const stepText = currentStep?.querySelector('.next-step-item-title')?.textContent.trim() ?? '';
  const approved = /^(?:review approved|approved|审核通过|审核已通过)$/iu.test(
    steps.length > 0 ? stepText : textOf(document.querySelector('h1,h2,[role="status"]') ?? document.body)
  );
  // A disabled approved profile is not a pending registration. Continue to application discovery.
  if (approved) return { kind: 'registration-approved' };

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
  const fields = fieldIds.map((id) => document.getElementById(id)).filter((field) => field && visible(field));
  const registrationFormDetected = fields.length >= 3;
  const missingFieldIds = fieldIds.filter((id) => {
    const element = document.getElementById(id);
    if (id === 'bizInfoDocs') {
      const result = document.getElementById('bizInfoDoc');
      if (result instanceof HTMLInputElement && result.value.trim() !== '') return false;
      if (element instanceof HTMLInputElement && (element.files?.length ?? 0) > 0) return false;
    }
    return (
      !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement) ||
      element.value.trim() === ''
    );
  });
  const agreement = [...document.querySelectorAll('input[type="checkbox"]')].find(visible);
  const registration = {
    missingFieldIds,
    agreementAccepted: agreement instanceof HTMLInputElement && agreement.checked
  };
  if (/rejected|review failed|not approved|审核未通过|已驳回|退回修改/iu.test(stepText || text)) {
    return { kind: 'prerequisite', reasonCode: 'developer-registration-rejected', registration };
  }
  if (
    registrationFormDetected &&
    /under review|审核中|审核处理中|2\s*[-–]\s*5\s*working days/iu.test(stepText || text)
  ) {
    return { kind: 'prerequisite', reasonCode: 'developer-registration-under-review', registration };
  }
  if (
    registrationFormDetected ||
    /you have not yet registered as a developer|尚未注册.*开发者/iu.test(text)
  ) {
    return { kind: 'prerequisite', reasonCode: 'developer-registration-required', registration };
  }
  if (/no applications?|you have not created an application|暂无应用|还没有应用/iu.test(text)) {
    return { kind: 'prerequisite', reasonCode: 'application-required', registration: null };
  }
  if (/application center|应用中心/iu.test(text)) return { kind: 'navigation-ready' };
  return { kind: 'waiting' };
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
