import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  density: Density;
  setDensity: (density: Density) => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
}

function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      density: 'comfortable',
      setDensity(density) {
        set({ density });
      },
      setTheme(theme) {
        applyTheme(theme);
        set({ theme });
      },
      toggleSidebar() {
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
      },
    }),
    {
      name: 'octa-bms-ui',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    },
  ),
);
