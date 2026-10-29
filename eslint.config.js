import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // ملفات الـ context تصدّر الـ Provider (مكوّن) مع الـ hook الخاص به في نفس الملف،
    // وهو نمط مقصود هنا؛ نسمح بأسماء الـ hooks فقط بدل تعطيل القاعدة بالكامل.
    files: ['src/context/**/*.jsx'],
    rules: {
      'react-refresh/only-export-components': ['error', {
        allowExportNames: ['useAuth', 'useToast', 'useVoice'],
      }],
    },
  },
])
