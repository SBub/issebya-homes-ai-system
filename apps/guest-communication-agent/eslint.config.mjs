import nextConfig from "eslint-config-next";
import { securityAndFormatConfig } from "../../eslint.config.base.mjs";

const eslintConfig = [
  ...nextConfig,
  ...securityAndFormatConfig,
  {
    // no-secrets/no-secrets scans comment text too, and this app's own
    // comment style (long slash-separated function-name lists, migration
    // filenames, test fixture phone numbers) trips its default entropy
    // threshold constantly with zero real secrets found — unlike
    // apps/website, where this rule stays at "error" (its original,
    // tuned severity). Kept as a visible warning here rather than
    // silenced outright.
    rules: { "no-secrets/no-secrets": "warn" },
  },
];

export default eslintConfig;
