const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'frontend', 'dashboard.html');
const STYLE_PATH = path.join(__dirname, '..', 'frontend', 'dashboard.css');
const SCRIPT_PATH = path.join(__dirname, '..', 'frontend', 'dashboard.js');
const FAVICON_PATH = path.join(__dirname, '..', 'frontend', 'favicon.svg');

function loadAsset(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function buildHtml() {
  const template = loadAsset(TEMPLATE_PATH);
  const styles = loadAsset(STYLE_PATH);
  const script = loadAsset(SCRIPT_PATH);
  const faviconBuffer = fs.readFileSync(FAVICON_PATH);
  const faviconData = `data:image/svg+xml;base64,${faviconBuffer.toString('base64')}`;

  return template
    .replace('<!--STYLE_PLACEHOLDER-->', `<style>\n${styles}\n</style>`)
    .replace('<!--SCRIPT_PLACEHOLDER-->', `<script>\n${script}\n</script>`)
    .replace('<!--FAVICON_PLACEHOLDER-->', `<link rel="icon" type="image/svg+xml" href="${faviconData}">`);
}

const isDev = process.env.NODE_ENV === 'development';
let cachedHtml = null;

function getHtml() {
  if (isDev || !cachedHtml) {
    cachedHtml = buildHtml();
  }
  return cachedHtml;
}

module.exports = (_req, res) => {
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.end(getHtml());
  } catch (err) {
    console.error('app_render_error', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'app_render_error' }));
  }
};
