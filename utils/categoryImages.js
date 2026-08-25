/**
 * Category-only photos. Never reuse one generic image across Hospital, Hotel, Shop, etc.
 */

const GENERIC_IDS = [
  'photo-1629909613654-28e377c37b09', // old dental chair used as global default
];

const u = (id) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=80`;

const SETS = {
  hospital: [
    u('photo-1519494026892-80bbd2d6fd0d'),
    u('photo-1538108149393-e8bf0a0d4c0e'),
    u('photo-1586773860418-d37222d8fce3'),
  ],
  doctor: [
    u('photo-1612349317150-e413f6a5b16d'),
    u('photo-1559839734-2b71ea197ec2'),
    u('photo-1576091160399-112ba8d25d1d'),
  ],
  hotel: [
    u('photo-1566073771259-6a8506099945'),
    u('photo-1551882547-ff40c63fe5fa'),
    u('photo-1542314831-068cd1dbfeeb'),
  ],
  shop: [
    u('photo-1441986300917-64674bd600d8'),
    u('photo-1472851294608-062f824d29cc'),
    u('photo-1528698827591-e19ccd7bc23d'),
  ],
  railway: [
    u('photo-1474487548417-7816ce0c3e09'),
    u('photo-1544620341-11cb2cdcd3d9'),
    u('photo-1527603815363-e79385e25c91'),
  ],
  food: [
    u('photo-1504674900247-0877df9cc836'),
    u('photo-1414235077428-338989a2e8c0'),
    u('photo-1517248135467-4c7edcad34c4'),
  ],
  grocery: [
    u('photo-1542838132-92c53300491e'),
    u('photo-1578916171728-46686eac8d58'),
    u('photo-1583258292688-d0213dc5a3a8'),
  ],
  salon: [
    u('photo-1560066984-138dadb4c035'),
    u('photo-1522337360788-8b13dee7a37e'),
    u('photo-1595476108010-b4d1f102b1b1'),
  ],
  temple: [
    u('photo-1548013146-72479768bada'),
    u('photo-1524492412937-b28074a5d7da'),
    u('photo-1477587458883-47145f1eea41'),
  ],
  fleet: [
    u('photo-1449965408869-eaa3f722e40d'),
    u('photo-1544620341-11cb2cdcd3d9'),
    u('photo-1519003722824-194d4455a60c'),
  ],
  realestate: [
    u('photo-1560518883-ce09059eeffa'),
    u('photo-1564013799919-ab600027ffc6'),
    u('photo-1600596542815-ffad4c1539a9'),
  ],
  trade: [
    u('photo-1611974789855-9c2a0a7236a3'),
    u('photo-1590283603385-17ffb3a7f29f'),
    u('photo-1460925895917-afdab827c52f'),
  ],
  qless: [
    u('photo-1556742049-0cfed4f6a45d'),
    u('photo-1556742111-a301076d9d18'),
    u('photo-1556740738-b6a63e27c4df'),
  ],
  offer: [
    u('photo-1607082348824-0a96f2a4b9da'),
    u('photo-1607083206968-13611e3d76db'),
    u('photo-1556740749-887f6717d7e4'),
  ],
  fashion: [
    u('photo-1483985988355-763728e1935b'),
    u('photo-1445205170230-053b83016050'),
    u('photo-1490481651871-ab68de25d43d'),
  ],
  electronics: [
    u('photo-1511707171634-5f897ff02aa9'),
    u('photo-1498049794561-7780e7231661'),
    u('photo-1517336714731-489689fd1ca8'),
  ],
  travel: [
    u('photo-1488646953014-85cb44e25828'),
    u('photo-1436491865332-7a61a109cc05'),
    u('photo-1507525428034-b723cf961d3e'),
  ],
  beauty: [
    u('photo-1596462502278-27bfdc403348'),
    u('photo-1522335789203-aabd1fc37c14'),
    u('photo-1512496015851-a90fb38ba796'),
  ],
  kids: [
    u('photo-1515488042361-ee00e0ddd4e4'),
    u('photo-1503454537195-1c803ee62086'),
    u('photo-1566454419290-57a64ccff1eb'),
  ],
  sports: [
    u('photo-1517836357463-d25dfeac3438'),
    u('photo-1571019614242-c5c5dee9f50b'),
    u('photo-1461896836934-ffe607ba6851'),
  ],
  pharmacy: [
    u('photo-1584308666744-24d5c474f2ae'),
    u('photo-1576602976047-174e57a4788e'),
    u('photo-1631549916768-4119b2e5f926'),
  ],
  auto: [
    u('photo-1492144534655-ae79c964c9d7'),
    u('photo-1486262715619-67b85e0b08d3'),
    u('photo-1503376780353-7e6692767b70'),
  ],
  home: [
    u('photo-1555041469-a586c61ea9bc'),
    u('photo-1586023492125-27b2c045efd7'),
    u('photo-1484101403633-562f891dc89a'),
  ],
  cyber: [
    u('photo-1550751827-4bd374c3f58b'),
    u('photo-1563986768609-322da13575f3'),
    u('photo-1510511459019-5dda7724ecb8'),
  ],
  matchmaking: [
    u('photo-1516589178581-6cd7833ae3b2'),
    u('photo-1529156069898-49953e39b3ac'),
    u('photo-1511632765486-a01980e01a18'),
  ],
};

const ALIASES = [
  { id: 'hospital', keys: ['hospital', 'healthcare', 'clinic', 'medical', 'nursing', 'health'] },
  { id: 'doctor', keys: ['doctor', 'physician', 'dental', 'dentist'] },
  { id: 'hotel', keys: ['hotel', 'resort', 'lodge', 'stay'] },
  { id: 'railway', keys: ['railway', 'rail', 'train', 'station'] },
  { id: 'food', keys: ['food', 'restaurant', 'cafe', 'bakery', 'hotelrestaurant'] },
  { id: 'grocery', keys: ['grocery', 'supermarket', 'retail', 'mart'] },
  { id: 'salon', keys: ['salon', 'spa', 'beauty', 'hair'] },
  { id: 'temple', keys: ['temple', 'mandir', 'religious'] },
  { id: 'fleet', keys: ['fleet', 'transport', 'logistics', 'truck'] },
  { id: 'realestate', keys: ['realestate', 'realty', 'property', 'housing'] },
  { id: 'trade', keys: ['trade', 'stock', 'broker', 'invest'] },
  { id: 'qless', keys: ['qless', 'queue'] },
  { id: 'offer', keys: ['offer', 'deals', 'discount'] },
  { id: 'fashion', keys: ['fashion', 'apparel', 'clothing', 'wear', 'ethnic', 'saree'] },
  { id: 'electronics', keys: ['electronic', 'mobile', 'laptop', 'gadget', 'phone'] },
  { id: 'travel', keys: ['travel', 'flight', 'holiday', 'tour', 'trip'] },
  { id: 'beauty', keys: ['beauty', 'cosmetic', 'makeup', 'skincare'] },
  { id: 'kids', keys: ['kid', 'toy', 'baby'] },
  { id: 'sports', keys: ['sport', 'fitness', 'gym'] },
  { id: 'pharmacy', keys: ['pharma', 'medicine', 'chemist'] },
  { id: 'auto', keys: ['auto', 'car', 'bike', 'tyre'] },
  { id: 'home', keys: ['home', 'furniture', 'decor', 'kitchen'] },
  { id: 'cyber', keys: ['cyber', 'suraksha', 'security'] },
  { id: 'matchmaking', keys: ['matchmaking', 'matrimony'] },
  { id: 'shop', keys: ['shop', 'store', 'general'] },
];

function compact(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function hashSeed(seed) {
  const s = String(seed ?? '0');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function resolveCategoryId(category) {
  const raw = String(category || '').toLowerCase();
  const key = compact(raw);
  if (!key) return 'shop';
  if (SETS[key]) return key;
  for (let i = 0; i < ALIASES.length; i += 1) {
    const row = ALIASES[i];
    if (row.keys.some((k) => key.includes(k) || raw.includes(k))) return row.id;
  }
  return 'shop';
}

function getCategoryImage(category, seed) {
  const id = resolveCategoryId(category);
  const list = SETS[id] || SETS.shop;
  return list[hashSeed(seed) % list.length];
}

function isGenericCategoryPlaceholder(uri) {
  const s = String(uri || '');
  if (!s) return true;
  return GENERIC_IDS.some((id) => s.includes(id));
}

function pickShopCover(vendor) {
  const direct = vendor?.cover_url || vendor?.banner_url || vendor?.image_url;
  if (direct && !isGenericCategoryPlaceholder(direct)) return direct;
  return getCategoryImage(vendor?.category, vendor?.id || vendor?.shop_name);
}

function pickProductImage(product, category) {
  const cat = category || product?.vendor_category || product?.category || product?.shop_category;
  const urls = Array.isArray(product?.image_urls) ? product.image_urls.filter(Boolean) : [];
  const real = urls.find((uri) => !isGenericCategoryPlaceholder(uri));
  if (real) return real;
  return getCategoryImage(cat, product?.id || product?.name);
}

function looksLikeSalonPhoto(uri) {
  const s = String(uri || '');
  return (SETS.salon || []).some((item) => {
    const id = String(item).match(/photo-[a-z0-9]+/i);
    return id ? s.includes(id[0]) : false;
  });
}

function resolveProductImages(urls, category, seed) {
  const cleaned = Array.isArray(urls) ? urls.filter(Boolean) : [];
  const real = cleaned.filter((uri) => !isGenericCategoryPlaceholder(uri));
  const catId = resolveCategoryId(category);
  const medical = catId === 'hospital' || catId === 'doctor' || catId === 'pharmacy';
  if (real.length) {
    if (medical && looksLikeSalonPhoto(real[0])) {
      return [getCategoryImage(catId, seed)];
    }
    return real;
  }
  return [getCategoryImage(category, seed)];
}

const api = {
  SETS,
  resolveCategoryId,
  getCategoryImage,
  isGenericCategoryPlaceholder,
  pickShopCover,
  pickProductImage,
  resolveProductImages,
};

module.exports = api;
