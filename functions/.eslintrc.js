module.exports = {
  root: true,
  env: {
    node: true,
    commonjs: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
  },
  extends: [
    "eslint:recommended"
  ],
  rules: {
    "no-restricted-globals": ["error", "name", "length"],
    "prefer-arrow-callback": "error",
    "max-len": "off",
    "quotes": ["error", "double", {"allowTemplateLiterals": true}],
  },
  globals: {
    require: "readonly",
    module: "readonly",
    exports: "readonly"
  }
};