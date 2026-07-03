import { m } from '@/core/i18n/messages';
import { SiteHeader } from '@/components/site-header';

export function Header() {
  const navLinks = [
    { href: '/#features', label: m['landing.nav.features']() },
    { href: '/pricing', label: m['landing.nav.pricing']() },
    { href: '/code', label: m['landing.nav.code']() },
  ];

  return <SiteHeader navLinks={navLinks} />;
}
