import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const config = [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...compat.extends('next/core-web-vitals'),
  { rules: { 'react/no-unescaped-entities': 'off', '@next/next/no-page-custom-font': 'off' } },
];
export default config;
