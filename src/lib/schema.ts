// Structured data for the club and its airfield.
import { facts } from './facts';

export function clubJsonLd(site: URL, base: string) {
  const url = new URL(base, site).toString();
  const [town, region] = facts.location.town.split(',').map((s) => s.trim());
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsClub',
    '@id': url + '#club',
    name: facts.club.name,
    alternateName: facts.club.short_name,
    url,
    email: facts.contact.email,
    telephone: '+1-' + facts.contact.phone.replace(/[()]/g, '').replace(' ', '-'),
    foundingDate: String(facts.club.founded),
    sport: 'Gliding',
    sameAs: [facts.contact.facebook],
    memberOf: facts.club.affiliations.map((name) => ({ '@type': 'SportsOrganization', name })),
    address: {
      '@type': 'PostalAddress',
      addressLocality: town,
      addressRegion: region === 'Saskatchewan' ? 'SK' : region,
      addressCountry: 'CA',
    },
    location: {
      '@type': 'Airport',
      name: facts.location.airfield,
      address: { '@type': 'PostalAddress', addressLocality: town, addressRegion: 'SK', addressCountry: 'CA' },
    },
    makesOffer: {
      '@type': 'Offer',
      name: 'Discovery Flight',
      price: facts.discovery_flight.price,
      priceCurrency: 'CAD',
      url: new URL('discovery-flight/', url).toString(),
    },
  };
}
