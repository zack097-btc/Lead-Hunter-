import { initDb, logActivity } from '../_lib/db.js';
import { getAuthUser } from '../_lib/auth.js';
import { applyCors, readBody } from '../_lib/http.js';

// -----------------------------------------------------------------------------
// Pitch generator - 100% free, no API, no key, no cost.
// Produces a tailored cold email + walk-in script per business type using
// built-in templates. Same request/response shape as before, so the frontend
// is unchanged.
//
// UPGRADE PATH: to switch to AI-written pitches later, set an ANTHROPIC_API_KEY
// and call the Anthropic API here instead (that requires a small amount of
// prepaid credit). This template version keeps you at $0.
// -----------------------------------------------------------------------------

// Each category defines the products to emphasize, a "noticed" observation for
// the walk-in, and a benefit angle for the email.
const CATEGORIES = {
  food: {
    match: /restaurant|cafe|coffee|bar|pub|fast|food|bakery|diner|grill|pizza|deli|nightclub/i,
    label: 'restaurant',
    products: 'window graphics, menu boards, storefront signage, and vehicle wraps',
    top: 'eye-catching window graphics and menu boards',
    noticed: 'your storefront gets a lot of foot traffic',
    benefit: 'bold window graphics and a sharp sign turn walk-by traffic into walk-in customers'
  },
  auto: {
    match: /car|auto|tyre|tire|vehicle|repair|mechanic|garage|fuel|gas|wash|rental/i,
    label: 'auto shop',
    products: 'fleet vehicle wraps, vehicle graphics, shop signage, and banners',
    top: 'fleet wraps and bold shop signage',
    noticed: 'you have vehicles that could be rolling billboards',
    benefit: 'a wrapped vehicle is seen by thousands of people a day — the cheapest advertising you can buy'
  },
  health: {
    match: /dentist|doctor|clinic|pharmacy|medical|health|veterinary|vet|dental|therapy/i,
    label: 'practice',
    products: 'professional signage, frosted privacy window vinyl, wayfinding signs, and door graphics',
    top: 'clean professional signage and privacy window vinyl',
    noticed: 'a clear, professional sign makes a big difference for a practice like yours',
    benefit: 'polished signage and frosted glass build instant trust with patients'
  },
  fitness: {
    match: /gym|fitness|sport|yoga|crossfit|martial|dance/i,
    label: 'gym',
    products: 'wall murals, motivational graphics, window branding, and floor decals',
    top: 'motivational wall murals and bold window branding',
    noticed: 'your walls are prime space for branding that fires members up',
    benefit: 'custom murals and window branding make members feel the energy the moment they arrive'
  },
  hospitality: {
    match: /hotel|motel|inn|guest|hostel|lodge/i,
    label: 'hotel',
    products: 'exterior signage, wayfinding signs, window graphics, and shuttle vehicle wraps',
    top: 'exterior signage and wayfinding',
    noticed: 'clear signage helps guests find you and remember you',
    benefit: 'strong exterior signage and wayfinding lift both curb appeal and guest experience'
  },
  professional: {
    match: /office|lawyer|attorney|account|estate|agent|bank|insurance|consult|realty/i,
    label: 'office',
    products: 'lobby and wall logo signage, door vinyl, and frosted window graphics',
    top: 'lobby logo signage and door vinyl',
    noticed: 'a branded lobby and door make a strong first impression on clients',
    benefit: 'a crisp logo wall and professional door vinyl signal that you mean business'
  },
  beauty: {
    match: /hair|beauty|salon|nail|spa|barber|cosmetic/i,
    label: 'salon',
    products: 'window graphics, salon signage, mirror decals, and wall branding',
    top: 'stylish window graphics and salon signage',
    noticed: 'your windows are perfect for graphics that pull people in',
    benefit: 'stylish window graphics and signage make your salon impossible to walk past'
  },
  retail: {
    match: /shop|store|retail|market|boutique|supermarket|convenience|hardware|clothes|grocery/i,
    label: 'store',
    products: 'storefront signage, window displays, promotional decals, and floor graphics',
    top: 'storefront signage and window displays',
    noticed: 'your window space is perfect for promotions that stop shoppers',
    benefit: 'fresh window displays and storefront signage pull browsers in off the sidewalk'
  }
};

const DEFAULT_CAT = {
  label: 'business',
  products: 'signage, vinyl wraps, decals, and window graphics',
  top: 'custom signage and window graphics',
  noticed: 'your storefront could really pop with some fresh graphics',
  benefit: 'sharp signage and window graphics make your business stand out and get remembered'
};

function categorize(businessType = '') {
  for (const c of Object.values(CATEGORIES)) {
    if (c.match.test(businessType)) return c;
  }
  return DEFAULT_CAT;
}

function buildEmail(name, cat) {
  return `Subject: Fresh signage & graphics ideas for ${name}

Hi ${name} team,

I'm with JZac Designs — we design and install ${cat.products} for local ${cat.label}s. I came across your business and thought there could be a great fit.

A ${cat.label} lives on first impressions, and ${cat.benefit}. We handle everything in-house from design to install — local, fast, and priced for small businesses.

Could I stop by this week with a couple of quick ideas and a free mockup? No pressure at all — I'd just love to show you what's possible for ${name}.

Thanks for your time,
The JZac Designs Team
Vinyl wraps · Signage · Decals · Window graphics`;
}

function buildPitch(name, cat) {
  return `Hi there — do you have a quick second? I'm with JZac Designs, we're local and we do ${cat.products}.

I was passing by ${name} and noticed ${cat.noticed}. We help ${cat.label}s stand out with ${cat.top}, and because ${cat.benefit}, it usually pays for itself pretty fast.

The best part — we do free mockups, so you can see exactly how it'll look before you spend a dollar. Who handles signage and branding for you? Is that you, or is there someone I could leave a card with?`;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuthUser(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const { businessName, businessType = 'business', address = '' } = readBody(req);
  if (!businessName) return res.status(400).json({ error: 'businessName is required' });

  const cat = categorize(`${businessType} ${businessName}`);
  const email = buildEmail(businessName, cat);
  const pitch = buildPitch(businessName, cat);

  await initDb();
  await logActivity({
    user_id: auth.uid,
    type: 'generate_pitch',
    business_name: businessName,
    business_address: address,
    detail: { businessType }
  });

  res.status(200).json({ email, pitch });
}
