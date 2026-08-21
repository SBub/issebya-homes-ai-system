import nextConfig from "eslint-config-next";
import prettierConfig from "eslint-config-prettier";
import noSecrets from "eslint-plugin-no-secrets";
import security from "eslint-plugin-security";

const eslintConfig = [
  ...nextConfig,
  prettierConfig,
  {
    plugins: { "no-secrets": noSecrets, security },
    rules: {
      "no-secrets/no-secrets": "error",
      "import/no-cycle": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-non-literal-regexp": "error",
      "security/detect-non-literal-require": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-possible-timing-attacks": "error",
      "security/detect-child-process": "error",
      "security/detect-non-literal-fs-filename": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-buffer-noassert": "error",
    },
  },
  {
    ignores: ["src/generated/**", "trees/**"],
  },
];

export default eslintConfig;
