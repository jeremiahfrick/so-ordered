export default {
  testEnvironment: 'node',
  globalSetup: './tests/tz-setup.ts',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
