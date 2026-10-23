import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';
import calendarDe from './calendar.de.json';
import calendarEn from './calendar.en.json';

void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: { ...de, calendar: calendarDe, nav: { ...de.nav, companyCalendar: calendarDe.title } } },
    en: { translation: { ...en, calendar: calendarEn, nav: { ...en.nav, companyCalendar: calendarEn.title } } },
  },
  lng: localStorage.getItem('octa-bms-lang') ?? 'de',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'de' | 'en') {
  localStorage.setItem('octa-bms-lang', lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
