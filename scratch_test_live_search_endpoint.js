// Test via local Next.js dev server endpoint
const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function test() {
  console.log('Testing /api/suggestions?q=naruto ...');
  const sugg = await get('http://localhost:3000/api/suggestions?q=naruto');
  console.log('Status:', sugg.status);
  console.log('Suggestions response:', sugg.data);

  console.log('\nTesting /search?q=naruto ...');
  const searchPage = await get('http://localhost:3000/search?q=naruto');
  console.log('Search page status:', searchPage.status);
  const cards = searchPage.data.match(/<article[^>]*>([\s\S]*?)<\/article>/gi) || [];
  console.log('Rendered cards on /search?q=naruto:', cards.length);
  if (cards.length > 0) {
    console.log('Sample card HTML snippet:', cards[0].slice(0, 250));
  }
}

test().catch(console.error);
