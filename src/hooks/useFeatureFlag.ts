import { useState, useEffect } from 'react';

export function useFeatureFlag(key: string, defaultValue = false) {
  const [enabled, setEnabled] = useState(defaultValue);

  useEffect(() => {
    const checkFlag = () => {
      const fromStorage = localStorage.getItem(`gvid_${key}`);
      const fromUrl = new URLSearchParams(window.location.search).get(key) === '1' || 
                      new URLSearchParams(window.location.search).get('ui') === key;
      setEnabled(fromStorage === 'true' || fromUrl || defaultValue);
    };

    checkFlag();
    window.addEventListener('storage', checkFlag);
    return () => window.removeEventListener('storage', checkFlag);
  }, [key, defaultValue]);

  const toggle = (value?: boolean) => {
    const newValue = value !== undefined ? value : !enabled;
    localStorage.setItem(`gvid_${key}`, String(newValue));
    setEnabled(newValue);
    // Force reload for clean state during development
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return { enabled, toggle };
}
