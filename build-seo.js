#!/usr/bin/env node
/**
 * VENOM static SEO page generator — Phase 3.
 *
 * WHY THIS EXISTS: Facebook, WhatsApp, and other link-preview crawlers
 * never run JavaScript — they only ever see the raw HTML a URL returns.
 * Phase 2 made the *app* update its title/description/image once it
 * loads and runs, which Google's crawler does see (Googlebot executes
 * JS) — but a share-preview crawler hitting /shop/men/.../product/123
 * directly would still only ever see the generic homepage tags, because
 * that's all that's in the raw HTML before any JavaScript runs.
 *
 * WHAT IT DOES: fetches the current product list from Supabase and, for
 * each product, writes a copy of index.html at the exact path GitHub
 * Pages needs to answer that product's URL with no extension — e.g. a
 * request to /shop/men/shirt/product/123 is answered by GitHub Pages
 * with the file shop/men/shirt/product/123.html if it exists (GitHub
 * Pages' documented extensionless-URL behavior). That copy's <head> is
 * customized with the product's own title, description, image, and
 * Product structured data baked directly into the raw HTML. Once it
 * loads in an actual browser, the exact same app script boots normally
 * and takes over from there — nothing about how the app itself works
 * changes; this only changes what the very first, pre-JS response looks
 * like.
 *
 * WHEN TO RUN: any time product names, prices, images, or stock change —
 * ideally right before every deploy. Just once, before the usual copy/
 * git steps:
 *
 *   cd ~/venom
 *   node build-seo.js
 *   git add . && git commit -m "Update generated product pages" && git push
 *
 * Requires: Node.js (already installed) and network access to Supabase.
 * No npm packages needed — uses Node's built-in fetch.
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = "https://otdbpahqfsarkzdpzwga.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AykcRsZJ3KH1-pmmbbEOpA_-2Cb6NbR";
const SITE_URL = "https://mdmisbahulhaq44-gif.github.io";
const DEFAULT_OG_IMAGE = "https://res.cloudinary.com/dtdztxbfg/image/upload/w_1200/v1787488489/IMG_20260823_183338_ge9det.png";

const REPO_ROOT = __dirname;
const TEMPLATE_PATH = path.join(REPO_ROOT, 'index.html');
const GENERATED_ROOT = path.join(REPO_ROOT, 'shop');

// --- Small helpers mirroring the exact same logic index.html itself uses,
// so a generated page's tags always match what the live app would set. ---

function parseCatPath(product){
return (product.cat || '').split('/').map(s => s.trim()).filter(Boolean)
}

function cldOpt(url, width){
if(!url || !url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url
if(!width || url.includes('/upload/w_')) return url
return url.replace('/upload/', `/upload/w_${width}/`)
}

function escapeHtmlText(s){
return String(s == null ? '' : s)
.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s){
return escapeHtmlText(s).replace(/"/g, '&quot;')
}

function buildShopPath(gender, catPath){
return `/shop/${gender}` + (catPath.length ? '/' + catPath.map(encodeURIComponent).join('/') : '')
}

async function fetchAllProducts(){
const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=*&order=created_at.desc`, {
headers: {
apikey: SUPABASE_ANON_KEY,
Authorization: `Bearer ${SUPABASE_ANON_KEY}`
}
})
if(!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`)
return res.json()
}

// Builds the customized <head> replacements for one product, and returns
// the full HTML document (the index.html template with those tags swapped
// in, plus a Product structured-data block appended before </head>).
function renderProductPage(template, product, routePath){
const title = `${product.name} — VENOM`
const priceStr = Number(product.price).toLocaleString()
const desc = `${product.name}${product.brand ? ' by ' + product.brand : ''} — ৳${priceStr} at VENOM. ` +
(Number(product.stock) > 0 ? 'In stock now' : 'Currently out of stock') +
', nationwide cash-on-delivery in Bangladesh.'
const images = (product.imgs ? product.imgs.split(',').map(s => s.trim()).filter(Boolean) : [])
const image = images.length ? cldOpt(images[0], 1200) : DEFAULT_OG_IMAGE
const url = SITE_URL + routePath

let html = template
html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtmlText(title)}</title>`)
html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttr(desc)}">`)
html = html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${escapeAttr(url)}">`)
html = html.replace(/<meta property="og:type" content="[^"]*">/, `<meta property="og:type" content="product">`)
html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttr(title)}">`)
html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttr(desc)}">`)
html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${escapeAttr(url)}">`)
html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${escapeAttr(image)}">`)

const ld = {
"@context": "https://schema.org",
"@type": "Product",
"name": product.name,
"image": images.map(u => cldOpt(u, 1200)),
"brand": { "@type": "Brand", "name": product.brand || "VENOM" },
"offers": {
"@type": "Offer",
"priceCurrency": "BDT",
"price": String(product.price),
"availability": Number(product.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
"url": url
}
}
const ldTag = `<script type="application/ld+json" id="productStructuredData">${JSON.stringify(ld)}</script>\n</head>`
html = html.replace(/<\/head>/, ldTag)

return html
}

function writeFile(routePath, html){
// routePath looks like /shop/men/Shirt/product/123 (URL-encoded, as it
// appears in the address bar). Web servers — GitHub Pages included —
// decode %XX sequences in the request path before matching it against
// files on disk, so the file/folder names on disk need to be the
// decoded, human-readable form (e.g. a literal "&" and space), not the
// encoded one, even though the URL itself stays encoded everywhere else
// (canonical tag, sitemap, og:url).
const decodedSegments = routePath.replace(/^\//, '').split('/').map(decodeURIComponent)
const relative = decodedSegments.join('/') + '.html'
const fullPath = path.join(REPO_ROOT, relative)
fs.mkdirSync(path.dirname(fullPath), { recursive: true })
fs.writeFileSync(fullPath, html)
return relative
}

function buildSitemap(urls){
const entries = urls.map(u => `  <url><loc>${escapeAttr(u)}</loc></url>`).join('\n')
return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`
}

async function main(){
console.log('Fetching products from Supabase...')
const products = await fetchAllProducts()
console.log(`Got ${products.length} products.`)

const template = fs.readFileSync(TEMPLATE_PATH, 'utf8')

// Start clean every run so a removed/renamed product's old generated
// page never lingers and keeps serving stale content forever.
if(fs.existsSync(GENERATED_ROOT)){
fs.rmSync(GENERATED_ROOT, { recursive: true, force: true })
}

const sitemapUrls = [SITE_URL + '/']
let count = 0

for(const product of products){
const catPath = parseCatPath(product)
// A unisex product is reachable from both the men's and women's shop —
// generate both real entry points so a link shared from either context
// still unfurls correctly, but point both at the same canonical URL
// (the men's one, picked arbitrarily) so Google doesn't see them as
// separate duplicate pages.
const genders = product.gender === 'unisex' ? ['men', 'women'] : [product.gender]
const canonicalPath = buildShopPath(genders[0], catPath) + `/product/${product.id}`

for(const gender of genders){
const routePath = buildShopPath(gender, catPath) + `/product/${product.id}`
const html = renderProductPage(template, product, canonicalPath)
const written = writeFile(routePath, html)
sitemapUrls.push(SITE_URL + routePath)
console.log(`  wrote ${written}`)
count++
}
}

fs.writeFileSync(path.join(REPO_ROOT, 'sitemap.xml'), buildSitemap(sitemapUrls))
console.log(`\nDone — generated ${count} product pages and sitemap.xml with ${sitemapUrls.length} URLs.`)
}

main().catch(err => {
console.error('Build failed:', err.message)
process.exit(1)
})
