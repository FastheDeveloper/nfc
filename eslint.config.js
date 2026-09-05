const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      'react/display-name': 'off',
    },
  },
  {
    // Jest's globals exist only in test files and the setup file. Declaring
    // them here rather than switching on `env: jest` project-wide keeps
    // `describe`/`it`/`jest` out of the app's namespace, for the same reason
    // test files import from '@jest/globals' instead of setting tsconfig
    // "types" (DEVLOG §2.6).
    files: ['jest.setup.js', '**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: { jest: 'readonly' },
    },
  },
]);
