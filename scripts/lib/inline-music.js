'use strict';

const renderMusic = (id, type = 'song') => {
  const normalizedId = String(id || '');
  const normalizedType = type === 'playlist' ? 'playlist' : 'song';

  if (!/^\d+$/.test(normalizedId)) {
    throw new Error('Inline music requires a numeric NetEase Cloud Music ID.');
  }

  const isPlaylist = normalizedType === 'playlist';
  return `
<div class="inline-music">
  <meting-js server="netease" type="${normalizedType}" id="${normalizedId}" fixed="false" mini="false" autoplay="false" loop="${isPlaylist ? 'all' : 'none'}" order="list" preload="none" volume="0.3" mutex="true" list-folded="${!isPlaylist}" list-max-height="260px" storage-name="zaphkiel-inline-music"></meting-js>
</div>`;
};

module.exports = { renderMusic };
