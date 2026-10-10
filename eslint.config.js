import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', '.tmp/', '.claude/', 'dist/', 'test-results/', 'playwright-report/'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // House rule: no `any` without a comment saying why (use an eslint-disable line with the reason).
      '@typescript-eslint/no-explicit-any': 'error',
      // House rule 5: time comes from clock.now(). Reading the wall clock is allowed only in lib/clock.ts.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Use now() from lib/clock.ts, not new Date().',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use now() from lib/clock.ts, not Date.now().',
        },
      ],
    },
  },
  { files: ['lib/clock.ts'], rules: { 'no-restricted-syntax': 'off' } },
);
