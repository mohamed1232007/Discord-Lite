import { createContext, useContext, useEffect, useState } from 'react';
import { THEME_OPTIONS } from './themeOptions';

const THEME_STORAGE_KEY = 'dis_lite_appearance_theme';
const THEME_MODES = new Set(['system', ...THEME_OPTIONS.map(({ id }) => id)]);

const ThemeContext = createContext(null);

function readThemeMode() {
  try {
    const savedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.has(savedMode) ? savedMode : 'midnight';
  } catch (error) {
    console.error('Unable to read the saved appearance theme.', error);
    return 'midnight';
  }
}

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [systemTheme, setSystemTheme] = useState(() => (
    window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const updateSystemTheme = (event) => setSystemTheme(event.matches ? 'light' : 'dark');

    mediaQuery.addEventListener('change', updateSystemTheme);
    return () => mediaQuery.removeEventListener('change', updateSystemTheme);
  }, []);

  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  const updateThemeMode = (nextMode) => {
    if (!THEME_MODES.has(nextMode)) {
      throw new TypeError(`Unsupported appearance theme: ${nextMode}`);
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch (error) {
      console.error('Unable to save the appearance theme.', error);
    }
    setThemeMode(nextMode);
  };

  return (
    <ThemeContext.Provider value={{ themeMode, resolvedTheme, setThemeMode: updateThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppearanceTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppearanceTheme must be used within a ThemeProvider');
  }
  return context;
}
