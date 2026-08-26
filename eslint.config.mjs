import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build-time asset generators and visual-QA harnesses. Plain Node scripts,
    // not part of the shipped bundle.
    "tools/**",
  ]),

  {
    /* Three.js is an imperative, mutable scene graph. Uniform objects,
       materials and geometries are created once and then written to every
       frame — that is the API. The React Compiler's immutability rules assume
       values that cross a hook boundary are frozen, which does not hold for a
       WebGL renderer and cannot be worked around without allocating per frame.
       Scoped strictly to the renderer. */
    files: ["components/webgl/**"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
