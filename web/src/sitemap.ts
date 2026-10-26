// Routes of the portal with their names in English and Hindi. App.tsx builds the public routes from this list,
// and the Sitemap page renders it, so the sitemap always matches the router.
export interface SitePage {
  path: string;
  en: string;
  hi: string;
}

export const PUBLIC_PAGES: SitePage[] = [
  { path: '/', en: 'Home and sign in', hi: 'मुख पृष्ठ और साइन इन' },
  { path: '/process', en: 'Approval process', hi: 'अनुमोदन प्रक्रिया' },
  { path: '/notices', en: 'What changed this cycle', hi: 'इस चक्र में क्या बदला' },
  { path: '/track', en: 'Track an application', hi: 'आवेदन की स्थिति देखें' },
  { path: '/help', en: 'Help', hi: 'सहायता' },
  { path: '/contact', en: 'Contact', hi: 'संपर्क' },
  { path: '/screen-reader', en: 'Screen reader access', hi: 'स्क्रीन रीडर सुविधा' },
  { path: '/accessibility', en: 'Accessibility statement', hi: 'सुगम्यता विवरण' },
  { path: '/sitemap', en: 'Sitemap', hi: 'साइटमैप' },
  { path: '/terms', en: 'Terms of use', hi: 'उपयोग की शर्तें' },
  { path: '/privacy', en: 'Privacy policy', hi: 'गोपनीयता नीति' },
  { path: '/hyperlinking', en: 'Hyperlinking policy', hi: 'हाइपरलिंकिंग नीति' },
  { path: '/copyright', en: 'Copyright policy', hi: 'कॉपीराइट नीति' },
];

export const WORK_PAGES: SitePage[] = [
  { path: '/college', en: 'My applications (institutions)', hi: 'मेरे आवेदन (संस्थान)' },
  { path: '/college/apply', en: 'New application', hi: 'नया आवेदन' },
  { path: '/college/compliance', en: 'Compliance', hi: 'अनुपालन' },
  { path: '/officer', en: 'Action Center (officers)', hi: 'कार्य केंद्र (अधिकारी)' },
  { path: '/team', en: 'Team (managers)', hi: 'टीम (प्रबंधक)' },
  { path: '/workforce', en: 'Workforce', hi: 'कार्यबल' },
  { path: '/committee', en: 'Committee', hi: 'समिति' },
  { path: '/authority', en: 'Decisions (competent authority)', hi: 'निर्णय (सक्षम प्राधिकारी)' },
  { path: '/bureau', en: 'Bureau', hi: 'ब्यूरो' },
  { path: '/rules', en: 'Rules Center', hi: 'नियम केंद्र' },
  { path: '/admin', en: 'Administration', hi: 'प्रशासन' },
];

export const SITEMAP: { group: { en: string; hi: string }; public: boolean; pages: SitePage[] }[] = [
  { group: { en: 'Public pages', hi: 'सार्वजनिक पृष्ठ' }, public: true, pages: PUBLIC_PAGES },
  { group: { en: 'After signing in', hi: 'साइन इन के बाद' }, public: false, pages: WORK_PAGES },
];
