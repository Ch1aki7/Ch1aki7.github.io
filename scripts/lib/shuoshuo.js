'use strict';

const fs = require('fs');
const path = require('path');
const frontMatter = require('hexo-front-matter');
const { renderMusic } = require('./inline-music');

const EMPTY = '<div class="shuoshuo-empty">还没有发布说说。</div>';
const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const asArray = value => value ? (Array.isArray(value) ? value : [value]) : [];
const isExternalUrl = value => /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(value);

const assetUrl = (root, talk, source) => {
  if (!source || isExternalUrl(source)) return source;

  let relative = String(source).replaceAll('\\', '/');
  if (relative.startsWith(`${talk.id}/`)) relative = relative.slice(talk.id.length + 1);
  const encodedPath = relative.split('/').map(encodeURIComponent).join('/');
  return `${root}shuoshuo/assets/${encodeURIComponent(talk.id)}/${encodedPath}`;
};

const readTalks = sourceDir => {
  const directory = path.join(sourceDir, '_talks');
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory)
    .filter(file => /\.md$/i.test(file) && file.toLowerCase() !== 'readme.md')
    .map(file => {
      const talk = frontMatter.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      const date = new Date(talk.date);
      return {
        ...talk,
        id: path.basename(file, path.extname(file)),
        assetDir: path.join(directory, path.basename(file, path.extname(file))),
        date,
        timestamp: Number.isNaN(date.getTime()) ? 0 : date.getTime()
      };
    })
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.timestamp - a.timestamp);
};

const renderImages = (images, talk, root) => {
  const sources = asArray(images).filter(Boolean).slice(0, 9)
    .map(source => assetUrl(root, talk, source));
  if (!sources.length) return '';

  const items = sources.map((src, index) =>
    `<img class="shuoshuo-gallery__image" src="${escapeHtml(src)}" alt="说说图片 ${index + 1}" loading="lazy" decoding="async">`
  ).join('');

  return `<div class="shuoshuo-gallery shuoshuo-gallery--${sources.length}" data-gallery="${escapeHtml(talk.id)}">${items}</div>`;
};

const renderLabels = (items, icon) => asArray(items)
  .filter(Boolean)
  .map(item => `<span><i class="fa-solid fa-${icon}"></i> ${escapeHtml(item)}</span>`)
  .join('');

const renderCard = (hexo, talk) => {
  const root = String(hexo.config.root || '/').replace(/\/?$/, '/');
  const validDate = talk.timestamp > 0;
  const displayDate = validDate
    ? new Intl.DateTimeFormat('zh-CN', {
      timeZone: hexo.config.timezone || 'Asia/Shanghai',
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false
    }).format(talk.date).replaceAll('/', '-')
    : '日期未知';
  const author = talk.author || hexo.config.author || 'Author';
  const avatar = talk.avatar || '/img/avatar.png';
  const content = hexo.render.renderSync({ text: talk._content || '', engine: 'markdown' })
    .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (_, start, source, end) =>
      `${start}${escapeHtml(assetUrl(root, talk, source))}${end}`
    );
  const music = talk.music?.id ? renderMusic(talk.music.id, talk.music.type) : '';
  const meta = [
    talk.location && `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(talk.location)}</span>`,
    talk.device && `<span><i class="fa-solid fa-mobile-screen-button"></i> ${escapeHtml(talk.device)}</span>`
  ].filter(Boolean).join('');

  return `
    <article class="shuoshuo-item" id="talk-${escapeHtml(talk.id)}">
      <span class="shuoshuo-item__dot" aria-hidden="true"></span>
      <div class="shuoshuo-card">
        <header class="shuoshuo-card__header">
          <img class="shuoshuo-card__avatar no-lightbox" src="${escapeHtml(avatar)}" alt="${escapeHtml(author)}">
          <div class="shuoshuo-card__identity">
            <strong>${escapeHtml(author)}</strong>
            <time${validDate ? ` datetime="${talk.date.toISOString()}"` : ''}>
              <i class="fa-regular fa-clock"></i> ${escapeHtml(displayDate)}
            </time>
          </div>
          ${talk.pinned ? '<span class="shuoshuo-card__pinned"><i class="fa-solid fa-thumbtack"></i> 置顶</span>' : ''}
        </header>
        <div class="shuoshuo-card__content">${content}</div>
        ${renderImages(talk.images, talk, root)}
        ${music}
        <footer class="shuoshuo-card__footer">
          <div class="shuoshuo-card__tags">${renderLabels(talk.tags, 'hashtag')}</div>
          <div class="shuoshuo-card__meta">${meta}</div>
        </footer>
      </div>
    </article>`;
};

const renderShuoshuo = (hexo, talks) => {
  if (!talks.length) return EMPTY;
  return `<section class="shuoshuo-list" aria-label="说说时间线">${talks.map(talk => renderCard(hexo, talk)).join('')}</section>`;
};

const readAssetFiles = talks => talks.flatMap(talk => {
  if (!fs.existsSync(talk.assetDir)) return [];

  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(source);
    if (!entry.isFile()) return [];
    return [{
      source,
      path: `shuoshuo/assets/${talk.id}/${path.relative(talk.assetDir, source).replaceAll('\\', '/')}`
    }];
  });

  return walk(talk.assetDir);
});

module.exports = { readAssetFiles, readTalks, renderShuoshuo };
