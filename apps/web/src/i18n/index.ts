import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: localStorage.getItem('octa-bms-lang') ?? 'de',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'de' | 'en') {
  localStorage.setItem('octa-bms-lang', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
