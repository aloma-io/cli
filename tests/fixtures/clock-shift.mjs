// Loaded into a CLI process by the callback tests (via NODE_OPTIONS): while the file named by
// ALOMA_TEST_CLOCK_FLAG exists, Date.now() reports ALOMA_TEST_CLOCK_SHIFT_MS milliseconds later.
import { existsSync } from "node:fs";

const shift = Number(process.env.ALOMA_TEST_CLOCK_SHIFT_MS || 0);
const flag = process.env.ALOMA_TEST_CLOCK_FLAG;
const realNow = Date.now.bind(Date);
Date.now = () => (flag && existsSync(flag) ? realNow() + shift : realNow());
