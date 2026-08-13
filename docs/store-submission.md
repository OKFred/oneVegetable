# Chrome Web Store 提交清单

检查日期：2026-08-13

## 已自动化验证

- MV3 manifest 的版本、名称和描述本地化、主页地址、权限最小集；
- 必选权限仅为 `storage` 和正式 HTTPS 网关，未出现 cookies 或必选 `<all_urls>`；
- 自定义网关与外部图片来源保持可选主机权限，并在首次使用和设置页说明用途；
- 中英文商店文案、权限理由、本地隐私页和仓库隐私政策存在且版本一致；
- 128 × 128 商店图标和 3 张真实扩展页面的 1280 × 800 截图；
- 真实 mutation 仍为关闭状态；
- 发布 ZIP 可复现，manifest 位于根目录，CI 产物同时包含 SHA-256 和 `store-listing/` 提交资料。

执行：

```bash
pnpm capture:store-assets # UI 发生可见变化后手工刷新截图
pnpm release:extension
```

截图必须来自构建后的扩展，不使用 Web Mock 冒充。`pnpm check:store-compliance` 会检查数量和尺寸，但无法判断文案的法律充分性或截图是否适合营销。

## 商店后台填写建议

- 单一用途：由用户主动操作的 Alibaba.com 国际站本地运营工作台；
- 类别：Productivity；
- 默认语言：简体中文，同时提交英文文案；
- 权限理由和数据用途声明以 `store-listing/listing.json` 为准；
- 隐私政策 URL：合并到 `master` 后使用 `https://github.com/OKFred/oneVegetable/blob/master/docs/privacy-policy.md`，提交前用未登录窗口确认公开可访问；
- 支持 URL：`https://github.com/OKFred/oneVegetable/issues`；
- 初次建议使用 Private trusted testers。Private、Unlisted 和 Public 同样需要经过政策审核，不能把 Private 当作免审通道。

## 审核人员测试说明

无需账号可以验证：

1. 首次打开时查看数据与权限显著披露，并主动勾选确认；
2. 打开 API 能力目录，检索已类型化的能力及其限制原因；
3. 打开设置，查看本地数据清单、脱敏诊断和额外主机权限；
4. 创建加密凭证保险库，锁定后确认凭证编辑区消失，再用口令解锁；
5. 导出不包含具体值的数据清单，使用确认短语彻底清除本地数据；
6. 重新加载，确认首次使用说明再次出现。

商品、RFQ、交易等 Web Mock 演示不属于扩展商店审核凭证。真实查询需要 Alibaba.com 开放平台测试账号；在能够安全提供审核账号前，不应宣称审核人员可以完成真实网络流程。

## 当前阻断项

- [ ] Chrome Web Store 开发者账号注册、身份验证和后台隐私字段尚未完成；
- [ ] 分支需合并到公开 `master`，并用未登录浏览器确认隐私政策 URL；
- [ ] 尚无可提供给审核人员的 Alibaba.com 测试账号；
- [ ] 真实账号的签名、权限、限流和响应结构 smoke test 尚未执行；
- [x] 用户口令加密保险库已实现并自动锁定；高安全场景仍建议使用用户控制的 BFF；
- [ ] 本文件不是法律意见，正式公开发布前仍需项目所有者确认隐私文本和适用地区要求。
