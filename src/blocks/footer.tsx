import { m } from '@/core/i18n/messages';
import { SiteFooter, type FooterColumn } from '@/components/site-footer';

export function Footer() {
  const columns: FooterColumn[] = [
    {
      title: m['landing.footer.feature'](),
      links: [
        { label: m['landing.footer.pricing'](), href: '/pricing' },
        { label: m['landing.footer.code'](), href: '/code' },
      ],
    },
    {
      title: m['landing.footer.resources'](),
      links: [
        { label: m['landing.footer.settings'](), href: '/settings' },
        { label: m['landing.footer.admin'](), href: '/admin' },
      ],
    },
    {
      title: m['landing.footer.legal'](),
      links: [
        { label: m['landing.footer.privacy'](), href: '/privacy-policy' },
        { label: m['landing.footer.terms'](), href: '/terms-of-service' },
      ],
    },
  ];

  return (
    <SiteFooter tagline={m['landing.footer.tagline']()} columns={columns} />
  );
}
