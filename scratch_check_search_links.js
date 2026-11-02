const http = require('http');

http.get('http://localhost:3000/search?q=naruto', (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    const matches = [...data.matchAll(/href="\/anime\/([^"]+)"/g)].map(m => m[1]);
    console.log('Anime links on search page:', matches);
  });
});
