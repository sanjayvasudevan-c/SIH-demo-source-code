// Public pages (add-on B3): approval process, track an application, help, contact and the pages GIGW expects
// (screen reader access, accessibility statement, sitemap, terms, privacy, hyperlinking, copyright).
// Every text page is marked "Prototype text". Bodies are given in English and Hindi.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Badge, Button, Field, Input } from '../../components/ui';
import { usePrefs, useT } from '../../lib/prefs';
import { formatDate } from '../../lib/format';
import { useTitle } from '../../lib/useTitle';
import { SITEMAP } from '../../sitemap';

function Page({ title, children, prototype = true }: { title: string; children: ReactNode; prototype?: boolean }) {
  const t = useT();
  useTitle(title);
  return (
    <div className="mx-auto max-w-content px-4 py-6">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm text-secondary">
        <Link to="/" className="text-accent underline">
          {t.publicNav.home}
        </Link>{' '}
        › {title}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {prototype ? <Badge tone="warning">{t.pages.prototypeText}</Badge> : null}
      </div>
      <div className="mt-4 flex max-w-prose flex-col gap-3 text-base">{children}</div>
    </div>
  );
}

/** Paragraphs in the current language. */
function Text({ en, hi }: { en: string[]; hi: string[] }) {
  const { lang } = usePrefs();
  return (
    <>
      {(lang === 'hi' ? hi : en).map((p) => (
        <p key={p}>{p}</p>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- approval process (from the current rules)

interface Current {
  cycle: string;
  version: number;
  process: { types: { type: string; label: string; route: string[]; documents: string[] }[]; timelines: Record<string, number> };
}

const TIMELINE_LABEL: Record<string, [string, string]> = {
  SCRUTINY: ['Scrutiny', 'संवीक्षा'],
  SAC_SHC: ['SAC/SHC', 'एसएसी/एसएचसी'],
  DECISION: ['Decision', 'निर्णय'],
  EVC_SCHEDULE: ['Scheduling the expert visit', 'विशेषज्ञ दौरे का निर्धारण'],
  EVC_REPORT: ['Expert visit report', 'विशेषज्ञ दौरे की रिपोर्ट'],
  VERIFICATION: ['Verifying compliance evidence', 'अनुपालन साक्ष्य का सत्यापन'],
};

export function ProcessPage() {
  const t = useT();
  const { lang } = usePrefs();
  const q = useQuery({ queryKey: ['public', 'current'], queryFn: () => api.get<Current>('/public/current') });
  const p = q.data?.process;
  return (
    <Page title={t.pages.process} prototype={false}>
      <Text
        en={['An institution files an application on this portal. Scrutiny officers check it against the rules of the approval cycle it is filed in; some types need an expert visit (EVC) or a standing committee (SAC/SHC). The competent authority decides. Every step has a deadline, and the institution can see where its application is at any time.']}
        hi={['संस्थान इस पोर्टल पर आवेदन करता है। संवीक्षा अधिकारी उसे उस अनुमोदन चक्र के नियमों के अनुसार जाँचते हैं जिसमें वह दाखिल हुआ है; कुछ प्रकारों के लिए विशेषज्ञ दौरा (ईवीसी) या स्थायी समिति (एसएसी/एसएचसी) आवश्यक है। सक्षम प्राधिकारी निर्णय लेता है। हर चरण की समय-सीमा होती है, और संस्थान किसी भी समय देख सकता है कि उसका आवेदन कहाँ है।']}
      />
      {q.data ? (
        <p className="text-sm text-secondary">
          {t.gov.rulesVersion(`${q.data.cycle.replace('-', '–')} v${q.data.version}`)} · <Link to="/notices" className="text-accent underline">{t.publicNav.changed}</Link>
        </p>
      ) : null}
      {p?.types.map((ty) => (
        <section key={ty.type} className="rounded-lg border bg-surface p-4">
          <h2 className="text-lg font-semibold">{ty.label}</h2>
          <p className="mt-1">{ty.route.join(' → ')}</p>
          <p className="mt-1 text-sm text-secondary">{ty.documents.join(', ')}</p>
        </section>
      ))}
      {p ? (
        <section className="rounded-lg border bg-surface p-4">
          <h2 className="text-lg font-semibold">{lang === 'hi' ? 'समय-सीमाएँ (कार्य दिवस)' : 'Timelines (working days)'}</h2>
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {Object.entries(p.timelines).map(([k, v]) => (
              <li key={k} className="tnum">
                {(TIMELINE_LABEL[k] ?? [k, k])[lang === 'hi' ? 1 : 0]}: {v}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}

// ---------------------------------------------------------------- track

interface Tracked {
  applicationNo: string;
  type: string;
  stage: string;
  status: string;
  route: string[];
  submittedOn: string;
  lastActionOn: string;
  rules: string;
}

export function TrackPage() {
  const t = useT();
  const [no, setNo] = useState('');
  const [pid, setPid] = useState('');
  const find = useMutation({ mutationFn: () => api.post<Tracked>('/public/track', { applicationNo: no.trim(), permanentId: pid.trim() }) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (no.trim() && pid.trim()) find.mutate();
  };
  const r = find.data;
  return (
    <Page title={t.track.title} prototype={false}>
      <p>{t.track.intro}</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
        <Field label={t.track.number}>{({ id }) => <Input id={id} value={no} placeholder="S-2026-0001" onChange={(e) => setNo(e.target.value)} />}</Field>
        <Field label={t.track.permanentId}>{({ id }) => <Input id={id} value={pid} placeholder="1-0000000000" onChange={(e) => setPid(e.target.value)} />}</Field>
        <Button type="submit" variant="primary" pending={find.isPending}>
          {t.track.find}
        </Button>
      </form>
      <div aria-live="polite">
        {find.error ? <p className="text-danger">{find.error instanceof ApiError && find.error.status === 404 ? t.track.notFound : (find.error as Error).message}</p> : null}
        {r ? (
          <section className="rounded-lg border bg-surface p-4">
            <h2 className="text-lg font-semibold">
              {r.applicationNo} · {r.type}
            </h2>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  [t.track.stage, r.stage],
                  [t.track.status, r.status],
                  [t.track.submitted, formatDate(r.submittedOn)],
                  [t.track.lastAction, formatDate(r.lastActionOn)],
                  [t.track.rules, r.rules],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-sm text-secondary">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-sm text-secondary">{r.route.join(' → ')}</p>
          </section>
        ) : null}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- help, contact and policy pages

export function HelpPage() {
  const t = useT();
  return (
    <Page title={t.pages.help}>
      <Text
        en={[
          'Institutions sign in with the nodal officer account to file applications, reply to deficiencies and upload compliance evidence. Officers see their tasks in the Action Center, with the reason each task came to them.',
          'Use the text size buttons (A- A A+) and the high contrast switch at the top of every page. Choose English or हिंदी there as well.',
          'For questions about this prototype, see Contact.',
        ]}
        hi={[
          'संस्थान आवेदन दाखिल करने, कमियों का उत्तर देने और अनुपालन साक्ष्य अपलोड करने के लिए नोडल अधिकारी खाते से साइन इन करते हैं। अधिकारी अपने कार्य कार्य केंद्र में देखते हैं, साथ में यह कारण भी कि हर कार्य उन्हें क्यों मिला।',
          'हर पृष्ठ के ऊपर पाठ आकार के बटन (A- A A+) और उच्च कंट्रास्ट स्विच का उपयोग करें। वहीं English या हिंदी भी चुनें।',
          'इस प्रोटोटाइप के बारे में प्रश्नों के लिए संपर्क पृष्ठ देखें।',
        ]}
      />
    </Page>
  );
}

export function ContactPage() {
  const t = useT();
  return (
    <Page title={t.pages.contact}>
      <p>{t.footer.team}</p>
      <p>{t.footer.institute}</p>
      <Text en={['This is a student prototype; it has no helpdesk. In a deployment this page would list the approval bureau’s helpdesk numbers and email.']} hi={['यह एक छात्र प्रोटोटाइप है; इसका कोई हेल्पडेस्क नहीं है। वास्तविक उपयोग में यह पृष्ठ अनुमोदन ब्यूरो के हेल्पडेस्क नंबर और ईमेल दिखाएगा।']} />
    </Page>
  );
}

export function ScreenReaderPage() {
  const t = useT();
  const { lang } = usePrefs();
  const readers = [
    ['NVDA', 'Windows', lang === 'hi' ? 'निःशुल्क, ओपन सोर्स' : 'Free, open source'],
    ['JAWS', 'Windows', lang === 'hi' ? 'व्यावसायिक' : 'Commercial'],
    ['VoiceOver', 'macOS, iOS', lang === 'hi' ? 'अंतर्निर्मित' : 'Built in'],
    ['TalkBack', 'Android', lang === 'hi' ? 'अंतर्निर्मित' : 'Built in'],
    ['Orca', 'Linux', lang === 'hi' ? 'निःशुल्क, ओपन सोर्स' : 'Free, open source'],
  ];
  return (
    <Page title={t.pages.screenReader}>
      <Text
        en={['This portal follows WCAG 2.2 AA and GIGW 3.0 so that people using screen readers can use it. The following screen readers work with it:']}
        hi={['यह पोर्टल WCAG 2.2 AA और GIGW 3.0 का पालन करता है, ताकि स्क्रीन रीडर का उपयोग करने वाले लोग इसका उपयोग कर सकें। निम्नलिखित स्क्रीन रीडर इसके साथ काम करते हैं:']}
      />
      <table className="text-left">
        <caption className="sr-only">{t.pages.screenReader}</caption>
        <thead className="text-sm text-secondary">
          <tr>
            <th scope="col" className="pr-6">{lang === 'hi' ? 'स्क्रीन रीडर' : 'Screen reader'}</th>
            <th scope="col" className="pr-6">{lang === 'hi' ? 'प्रणाली' : 'System'}</th>
            <th scope="col">{lang === 'hi' ? 'प्रकार' : 'Kind'}</th>
          </tr>
        </thead>
        <tbody>
          {readers.map(([n, s, k]) => (
            <tr key={n}>
              <td className="pr-6">{n}</td>
              <td className="pr-6">{s}</td>
              <td>{k}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Page>
  );
}

export function AccessibilityPage() {
  const t = useT();
  return (
    <Page title={t.pages.accessibility}>
      <Text
        en={[
          'The portal aims to meet WCAG 2.2 level AA and GIGW 3.0. It offers a skip link, keyboard access to every control, visible focus, text size controls, a high contrast theme, English and Hindi, and status shown with text and icons, never colour alone.',
          'Known limits of the prototype: uploaded documents are placeholders and may not be accessible PDFs; case data entered by users is shown as entered.',
          'Report an accessibility problem through the Contact page.',
        ]}
        hi={[
          'यह पोर्टल WCAG 2.2 स्तर AA और GIGW 3.0 को पूरा करने का लक्ष्य रखता है। इसमें मुख्य सामग्री पर जाने का लिंक, हर नियंत्रण तक कीबोर्ड पहुँच, स्पष्ट फ़ोकस, पाठ आकार नियंत्रण, उच्च कंट्रास्ट थीम, अंग्रेज़ी और हिंदी, तथा केवल रंग के बजाय पाठ और आइकन से स्थिति दिखाई जाती है।',
          'प्रोटोटाइप की ज्ञात सीमाएँ: अपलोड किए गए दस्तावेज़ प्लेसहोल्डर हैं और हो सकता है कि वे सुगम्य पीडीएफ़ न हों; उपयोगकर्ताओं द्वारा दर्ज मामले का डेटा जैसा दर्ज किया गया वैसा ही दिखाया जाता है।',
          'सुगम्यता संबंधी समस्या की सूचना संपर्क पृष्ठ के माध्यम से दें।',
        ]}
      />
    </Page>
  );
}

export function SitemapPage() {
  const t = useT();
  const { lang } = usePrefs();
  return (
    <Page title={t.pages.sitemap} prototype={false}>
      {SITEMAP.map((g) => (
        <section key={g.group.en}>
          <h2 className="text-lg font-semibold">{lang === 'hi' ? g.group.hi : g.group.en}</h2>
          <ul className="mt-1 list-disc pl-6">
            {g.pages.map((p) => (
              <li key={p.path}>
                {g.public ? (
                  <Link to={p.path} className="text-accent underline">
                    {lang === 'hi' ? p.hi : p.en}
                  </Link>
                ) : (
                  <span>
                    {lang === 'hi' ? p.hi : p.en} <span className="font-mono text-sm text-muted">{p.path}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  );
}

export function TermsPage() {
  const t = useT();
  return (
    <Page title={t.pages.terms}>
      <Text
        en={['This prototype is provided for evaluation at Smart India Hackathon 2026. It is not an official AICTE system and creates no rights or obligations. All data in it is fictional demo data.']}
        hi={['यह प्रोटोटाइप स्मार्ट इंडिया हैकथॉन 2026 में मूल्यांकन के लिए प्रदान किया गया है। यह AICTE की आधिकारिक प्रणाली नहीं है और इससे कोई अधिकार या दायित्व उत्पन्न नहीं होते। इसका सारा डेटा काल्पनिक डेमो डेटा है।']}
      />
    </Page>
  );
}

export function PrivacyPage() {
  const t = useT();
  return (
    <Page title={t.pages.privacy}>
      <Text
        en={[
          'The prototype stores only fictional demo data. In a deployment, application data and documents would stay on AICTE servers in India, be used only for the approval process, and be kept as the records retention rules require.',
          'The portal uses no third-party analytics, advertising or fonts from the internet. Your text size, contrast and language choice are kept in your browser only.',
        ]}
        hi={[
          'यह प्रोटोटाइप केवल काल्पनिक डेमो डेटा संग्रहीत करता है। वास्तविक उपयोग में आवेदन डेटा और दस्तावेज़ भारत में AICTE के सर्वरों पर रहेंगे, केवल अनुमोदन प्रक्रिया के लिए उपयोग होंगे, और अभिलेख प्रतिधारण नियमों के अनुसार रखे जाएँगे।',
          'यह पोर्टल किसी तृतीय पक्ष के विश्लेषण, विज्ञापन या इंटरनेट से फ़ॉन्ट का उपयोग नहीं करता। आपका पाठ आकार, कंट्रास्ट और भाषा का चयन केवल आपके ब्राउज़र में रखा जाता है।',
        ]}
      />
    </Page>
  );
}

export function HyperlinkingPage() {
  const t = useT();
  return (
    <Page title={t.pages.hyperlinking}>
      <Text
        en={['You may link to pages of this portal without asking. Do not load its pages inside frames on another site. The portal itself links only to its own pages.']}
        hi={['आप बिना अनुमति माँगे इस पोर्टल के पृष्ठों से लिंक कर सकते हैं। इसके पृष्ठों को किसी अन्य साइट पर फ़्रेम के भीतर न दिखाएँ। यह पोर्टल केवल अपने ही पृष्ठों से लिंक करता है।']}
      />
    </Page>
  );
}

export function CopyrightPage() {
  const t = useT();
  return (
    <Page title={t.pages.copyright}>
      <Text
        en={['The prototype’s code and text are the work of the student team. It uses no official logos, emblems or text of any government body. Fonts are Noto Sans and Noto Sans Devanagari under the SIL Open Font License.']}
        hi={['प्रोटोटाइप का कोड और पाठ छात्र टीम का कार्य है। इसमें किसी सरकारी निकाय का आधिकारिक लोगो, प्रतीक चिह्न या पाठ उपयोग नहीं किया गया है। फ़ॉन्ट SIL ओपन फ़ॉन्ट लाइसेंस के अंतर्गत Noto Sans और Noto Sans Devanagari हैं।']}
      />
    </Page>
  );
}
