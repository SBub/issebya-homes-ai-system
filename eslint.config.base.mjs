// Shared ESLint building blocks for every Next.js app in this repo. Each
// app's own eslint.config.mjs spreads `securityAndFormatConfig` alongside
// `eslint-config-next` (app-specific, since eslint-config-next needs to run
// from that app's own directory to resolve its Next.js project correctly)
// plus its own `ignores`. Kept as a plain module, not a config file of its
// own, so ESLint's flat-config discovery never picks it up directly.
import prettierConfig from "eslint-config-prettier";
import noSecrets from "eslint-plugin-no-secrets";
import security from "eslint-plugin-security";

export const securityAndFormatConfig = [
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
];
