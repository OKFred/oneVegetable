export const shippingServices = {
  title: '中国始发第三方物流服务',
  independentNotice:
    '独立于 Alibaba，无需 TOP / IOP 授权。手动估算会向服务商发送货物信息，并可能消耗额度或产生费用。',
  directoryDetails: '覆盖范围与隐私说明',
  serviceDetails: '覆盖详情 / 来源',
  mainlandChina: '中国大陆（CN）',
  route: '估算线路 · 中国大陆始发',
  countryExample: '美国 / 英国 / US / GB',
  countryHelp: '可选择本地国家名称建议，或填写代码，如 US / GB。名称建议不代表具体线路覆盖。',
  estimateNotice: '仅为市场估算，并非承运商报价；须核对并单独同意后才发送。',
  estimateDetails: '数据分享、费用与估算范围',
  quotedAt: '估算时间：{time}',
  directoryDisclaimer:
    '仅提供官方服务目录，不宣称全球最低价。支持中国大陆始发不代表覆盖具体线路、货物或账号，请向服务商核实。',
  localPrivacy:
    '目录仅在本地按方式和关键词筛选，不使用线路字段。货物输入仅保留在当前页面；不保存地址，也不把地址拼入官网链接。',
  originCountry: '始发国（只读）',
  mode: '运输方式',
  keyword: '服务名称或关键词',
  modes: {
    express: '国际快递',
    parcel: '跨境小包',
    air: '空运',
    lcl: '海运拼箱',
    fcl: '海运整箱'
  },
  names: {
    sf: '顺丰国际',
    dhl: 'DHL 国际快递',
    ups: 'UPS',
    fedex: '联邦快递 FedEx',
    freightos: 'Freightos',
    maersk: '马士基 Maersk',
    'ups-forwarding': 'UPS 供应链货运'
  },
  kinds: {
    carrier: '承运 / 货运服务',
    marketplace: '物流市场平台'
  },
  coverage: {
    'documented-mainland-origin': '官方资料记载大陆始发；具体线路及货物仍需确认。',
    'route-check-required': '请直接确认大陆始发服务和具体线路是否可用。'
  },
  officialWebsite: '打开官方网站',
  source: '覆盖范围来源',
  checkedOn: '资料核对日期 {date}',
  directoryEmpty: '没有匹配的服务，请更换运输方式或关键词。',
  marketEstimate: '市场估算',
  notReturned: '未返回',
  configure: '配置 Freightos / 开通指引',
  configured: '已配置 API 密钥',
  notConfigured: '尚未配置 API 密钥',
  revision: '配置版本：{revision}',
  livePending: '本应用真实接入待验收，并非您的账号状态。保存配置和模拟夹具测试不代表真实服务已可用。',
  estimateDisclaimer:
    'Freightos 返回市场均值，并非承运商或账号报价、订舱承诺或最低价保证。进口清关、附加服务和保险等可能未包含，最终费用须另行确认。本页不会发货、购买运力或生成面单。',
  fees: '每次手动请求都可能消耗服务商额度或产生费用，包括未成功的集成请求。官方公开免费上限为每日 10 次，仍以账号约定为准。没有试运行，不自动重试或轮询。',
  unavailable: '当前运行环境未接入物流服务；仍可浏览目录和开通指引。',
  websiteOnly: '此 API 不提供国际快递或小包估算，请使用上方官方链接；不会发送 API 请求。',
  packaging: '包装类型',
  packages: {
    boxes: '纸箱',
    pallets: '托盘',
    container20: '20 英尺整箱',
    container40: '40 英尺整箱',
    container40HC: '40 英尺高箱'
  },
  fields: {
    originProvince: '始发省份',
    originCity: '始发城市',
    originPostal: '始发邮编（选填）',
    destinationCountry: '目的国',
    destinationProvince: '目的省 / 州（选填）',
    destinationCity: '目的城市',
    destinationPostal: '目的邮编（选填）',
    quantity: '包装 / 集装箱数量',
    weightKg: '单件重量（kg）',
    lengthCm: '单件长（cm）',
    widthCm: '单件宽（cm）',
    heightCm: '单件高（cm）',
    declaredValue: '货物申报价值',
    pickupDate: '提货日期（选填）'
  },
  currency: '期望报价币种',
  inputHelp:
    '估算须填写始发省市、目的国及城市和有效货物信息。散货须填写重量及三边尺寸，整箱不发送尺寸。按服务商实际返回币种展示，不换汇、不改币种。',
  review: '核对本次估算请求',
  processing: '正在处理单项操作…',
  failed: '物流操作未完成，请检查配置和输入。未使用模拟结果兜底，也未自动重试。',
  saved: 'Freightos 配置已保存，未发起估算。',
  cleared: 'Freightos 配置已清除。',
  noRates: '本次请求未返回运价，不展示示例价或兜底价格。',
  transit: '预计时效：{from}–{to} 天',
  freightosAttribution: '市场估算来源 Freightos · 官方网站',
  onboarding: '从无账号开始开通',
  onboardingSteps:
    '1. 打开官方 Rate Estimate API 指引，按页面联系方式申请生产环境 API 密钥，并确认大陆始发线路权限。普通市场账号登录不等于 API 密钥。\n2. 核实数据条款、收费及每日额度；收费接入须先取得授权。\n3. 仅在下方保存 Freightos 生产密钥。保存不会测试连接，也不会请求估算。\n4. 返回表单，核对具体货物，并对每次手动请求单独同意。经授权的真实请求成功前，真实询价仍为待验收。',
  apiGuide: '官方 API / 密钥申请指引',
  termsLink: 'Freightos 数据条款',
  downloadGuide: '下载开通核对清单',
  keyPrivacy:
    '密钥仅写入，由运行环境加密保存；页面只显示配置状态和版本。保存或关闭后清空密钥输入，不存储货物地址和服务商原始响应。',
  apiKey: '生产环境 API 密钥',
  acceptTerms: '我已阅读并接受本次配置适用的 Freightos 数据条款。',
  acceptConfigCost: '我已了解服务商额度和潜在费用；保存密钥不代表授权任何估算请求。',
  save: '仅保存 Freightos',
  clear: '清除配置',
  clearTitle: '清除 Freightos 配置？',
  clearDescription: '按当前显示版本移除已保存密钥；不会撤回已发送给 Freightos 的请求。',
  confirmTitle: '确认本次单次估算',
  confirmDescription:
    '请核对下方已冻结的服务商、请求 ID、配置版本和实际发送的货物字段。重量及尺寸按单件计算，不是合计；空的选填项和整箱未使用的尺寸不展示。授权仅限本次请求。',
  acceptData: '我同意仅为本次请求将所示货物信息发送给 Freightos（ship.freightos.com）。',
  acceptQuoteCost: '我已知晓本次单次请求消耗额度且可能产生服务商费用，不授权自动重试。',
  sendOnce: '仅发送一次至 Freightos'
};
