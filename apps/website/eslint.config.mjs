import nextConfig from "eslint-config-next";
import { securityAndFormatConfig } from "../../eslint.config.base.mjs";

const eslintConfig = [
  ...nextConfig,
  ...securityAndFormatConfig,
  {
    ignores: [
      "src/generated/**",
      "trees/**",
      "src/app/(main)/booking/\\[type\\]/page-1.tsx",
      "src/app/(main)/booking/\\[type\\]/store-1.tsx",
    ],
  },
];

export default eslintConfig;
