// Flat config (ESLint 9+). Two blocks: main.js runs in the browser,
// serve.js runs in Node -- different globals, so they're linted separately
// rather than guessing a shared environment.
export default [
  {
    files: ["main.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        localStorage: "readonly",
        requestAnimationFrame: "readonly",
        performance: "readonly",
        AudioContext: "readonly",
        webkitAudioContext: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      "no-redeclare": "error",
    },
  },
  {
    files: ["serve.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
    },
  },
];
