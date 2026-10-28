import nextConfig from "eslint-config-next";
import { securityAndFormatConfig } from "../../eslint.config.base.mjs";

const eslintConfig = [...nextConfig, ...securityAndFormatConfig];

export default eslintConfig;
