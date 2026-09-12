import * as product from './generated/validators-product';
import * as rfq from './generated/validators-rfq';
import * as trade from './generated/validators-trade';
import * as logistics from './generated/validators-logistics';
import * as insights from './generated/validators-insights';
import * as photo from './generated/validators-photo';
import * as platform from './generated/validators-platform';
import { createCapabilityValidation } from './capability-validation-engine';

// MV3 only supports static ESM imports. Share the validators and engine, not the
// page-oriented dynamic-import loader. Never add DOM, import() or remote code here.
const modules = { product, rfq, trade, logistics, insights, photo, platform };
export const { validateCapabilityRequest, validateCapabilityResponse } =
  /* @__PURE__ */ createCapabilityValidation((domain) => modules[domain]);
