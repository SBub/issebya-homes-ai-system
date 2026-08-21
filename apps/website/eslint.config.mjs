import nextConfig from "eslint-config-next";
import { securityAndFormatConfig } from "../../eslint.config.base.mjs";

const eslintConfig = [
  ...nextConfig,
  ...securityAndFormatConfig,
  {
    ignores: ["src/generated/**", "trees/**"],
  },
];

export default eslintConfig;
