'use strict';

const fs = require('fs');
const { readAssetFiles, readTalks, renderShuoshuo } = require('../lib/shuoshuo');

const pageUrl = (root, page) => `${root}shuoshuo/${page > 1 ? `page/${page}/` : ''}`;

const renderPagination = (root, current, total) => {
  if (total < 2) return '';

  const link = page => `<a class="shuoshuo-pagination__number${page === current ? ' is-current' : ''}" href="${pageUrl(root, page)}"${page === current ? ' aria-current="page"' : ''}>${page}</a>`;
  return `
  <nav class="shuoshuo-pagination" aria-label="说说分页">
    ${current > 1 ? `<a class="shuoshuo-pagination__step" href="${pageUrl(root, current - 1)}" aria-label="上一页"><i class="fa-solid fa-angle-left"></i></a>` : '<span class="shuoshuo-pagination__step is-disabled"><i class="fa-solid fa-angle-left"></i></span>'}
    <div class="shuoshuo-pagination__pages">${Array.from({ length: total }, (_, index) => link(index + 1)).join('')}</div>
    ${current < total ? `<a class="shuoshuo-pagination__step" href="${pageUrl(root, current + 1)}" aria-label="下一页"><i class="fa-solid fa-angle-right"></i></a>` : '<span class="shuoshuo-pagination__step is-disabled"><i class="fa-solid fa-angle-right"></i></span>'}
  </nav>`;
};

hexo.extend.generator.register('local-shuoshuo', () => {
  const talks = readTalks(hexo.source_dir, hexo.config.timezone || 'Asia/Shanghai');
  const configuredSize = Number(hexo.config.shuoshuo?.per_page);
  const pageSize = Number.isInteger(configuredSize) && configuredSize > 0 ? configuredSize : 20;
  const pageCount = Math.max(1, Math.ceil(talks.length / pageSize));
  const root = String(hexo.config.root || '/').replace(/\/?$/, '/');

  const pages = Array.from({ length: pageCount }, (_, index) => {
    const currentPage = index + 1;
    const pageTalks = talks.slice(index * pageSize, currentPage * pageSize);
    const content = `
<div id="shuoshuo-page">
  ${renderShuoshuo(hexo, pageTalks)}
  ${renderPagination(root, currentPage, pageCount)}
</div>`;

    return {
      path: currentPage === 1 ? 'shuoshuo/index.html' : `shuoshuo/page/${currentPage}/index.html`,
      data: {
        title: currentPage === 1 ? '说说' : `说说 - 第 ${currentPage} 页`,
        date: new Date('2026-09-16T18:00:00+08:00'),
        type: 'page',
        top_img: false,
        comments: currentPage === 1,
        aside: false,
        keywords: ['说说', '动态', '开发记录'],
        content
      },
      layout: ['page']
    };
  });

  const assets = readAssetFiles(talks).map(asset => ({
    path: asset.path,
    data: async () => fs.promises.readFile(asset.source)
  }));

  return [...pages, ...assets];
});
