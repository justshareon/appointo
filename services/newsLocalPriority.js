/**
 * Local news / offers get highest priority in trade news feeds.
 */

const LOCAL_OFFER_CATEGORIES = new Set([
    'local_offers',
    'local_news',
    'local',
    'food_coupons',
    'new_offer',
    'trending_offer',
    'trending_deals',
    'travel',
    'coupons',
    'deals',
]);

const LOCAL_SOURCE_CATEGORY_KEYS = [
    'local',
    'coupon',
    'offer',
    'deal',
    'food',
    'travel',
    'flash',
];

const LOCAL_TEXT_KEYWORDS = [
    'local',
    'nearby',
    'offer',
    'coupon',
    'deal',
    'discount',
    'sale',
    'cashback',
    'restaurant',
    'food',
    'swiggy',
    'zomato',
];

const norm = (v) => String(v || '').trim().toLowerCase();

const matchesLocation = (item, settings = {}) => {
    const defLocality = norm(settings.news_default_locality);
    const defCity = norm(settings.news_default_city);
    const defCountry = norm(settings.news_default_country || settings.news_preset_country || 'in');

    const locality = norm(item.locality);
    const city = norm(item.city);
    const country = norm(item.country);

    if (defLocality && locality && locality === defLocality) return 3;
    if (defCity && city && city === defCity) return 2;
    if (defCountry && country && country === defCountry) return 1;
    return 0;
};

const categoryBoost = (item) => {
    const cat = norm(item.category || item._cat || '');
    if (LOCAL_OFFER_CATEGORIES.has(cat)) return 40;
    if (LOCAL_SOURCE_CATEGORY_KEYS.some((k) => cat.includes(k))) return 30;
    return 0;
};

const textBoost = (item) => {
    const text = norm(`${item.text || ''} ${item.description || ''} ${item.source || ''}`);
    let score = 0;
    LOCAL_TEXT_KEYWORDS.forEach((kw) => {
        if (text.includes(kw)) score += 4;
    });
    return Math.min(score, 24);
};

function scoreNewsItem(item, settings = {}) {
    let score = 0;
    if (item.is_local || item.source_type === 'local_vendor') score += 100;
    score += categoryBoost(item);
    score += matchesLocation(item, settings) * 15;
    score += textBoost(item);
    if (item.locality || item.city) score += 5;
    return score;
}

function sortNewsItems(items, settings = {}) {
    return [...(items || [])].sort((a, b) => {
        const diff = scoreNewsItem(b, settings) - scoreNewsItem(a, settings);
        if (diff !== 0) return diff;
        const da = new Date(a.date || a.published_at || 0).getTime();
        const db = new Date(b.date || b.published_at || 0).getTime();
        return db - da;
    });
}

function sortSources(sources = []) {
    const priority = (source) => {
        const cat = norm(source.category || '');
        const name = norm(source.name || '');
        if (source.local === true || source.priority === 'local') return 100;
        if (LOCAL_OFFER_CATEGORIES.has(cat)) return 80;
        if (LOCAL_SOURCE_CATEGORY_KEYS.some((k) => cat.includes(k) || name.includes(k))) return 60;
        if (cat === 'global_news' || name.includes('global')) return 10;
        return 30;
    };
    return [...sources].sort((a, b) => priority(b) - priority(a));
}

function sortCategories(categories = [], settings = {}) {
    const catScore = (name) => {
        const n = norm(name);
        if (n.includes('local')) return 100;
        if (LOCAL_OFFER_CATEGORIES.has(n)) return 80;
        if (LOCAL_SOURCE_CATEGORY_KEYS.some((k) => n.includes(k))) return 60;
        if (n === 'all') return 200;
        return 20;
    };

    return [...categories]
        .map((c) => ({
            ...c,
            items: sortNewsItems(c.items || [], settings),
        }))
        .sort((a, b) => {
            const diff = catScore(b.name) - catScore(a.name);
            if (diff !== 0) return diff;
            return (b.items?.length || 0) - (a.items?.length || 0);
        });
}

function productsToLocalNewsItems(products = [], settings = {}) {
    const defCity = settings.news_default_city || '';
    const defLocality = settings.news_default_locality || '';
    const defCountry = settings.news_default_country || settings.news_preset_country || 'IN';

    return (products || [])
        .filter((p) => p && (p.offer || p.offer_amount || p.discount))
        .slice(0, 40)
        .map((p) => {
            const price = p.price != null ? `₹${Number(p.price).toLocaleString('en-IN')}` : '';
            const offer = p.offer || (p.offer_amount ? `Save ₹${p.offer_amount}` : 'Special offer');
            const shop = p.shop_name || p.vendor_name || 'Local shop';
            return {
                id: `local-offer-${p.id || p.vendor_id}-${p.name}`,
                text: `${offer} — ${p.name}${price ? ` (${price})` : ''} @ ${shop}`,
                description: p.description || '',
                link: p.id ? `/product/${p.id}` : '',
                source: shop,
                source_type: 'local_vendor',
                is_local: true,
                category: 'local_offers',
                country: defCountry,
                city: p.city || defCity,
                locality: p.locality || p.location_name || defLocality,
                image: p.image || p.thumbnail || '',
                date: new Date().toISOString(),
            };
        });
}

module.exports = {
    scoreNewsItem,
    sortNewsItems,
    sortSources,
    sortCategories,
    productsToLocalNewsItems,
    LOCAL_OFFER_CATEGORIES,
};
