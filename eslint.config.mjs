import next from 'eslint-config-next/core-web-vitals';
import ts from 'eslint-config-next/typescript';
const config = [
  ...next,
  ...ts,
  {
    ignores: [
      '**/.next/**',
      'node_modules/**',
      '**/next-env.d.ts',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  { rules: { '@next/next/no-img-element': 'off', '@next/next/no-html-link-for-pages': 'off' } },
];

export default config;
